// Browser-only. The whole duck loop in one place: this is what the session page (and /dev/voice) uses.
// Code on the server decides every move; this class only listens, sends turns, and speaks the line back.
import { DUCK, VOICE } from "@/lib/duck/config";
import type { SessionStart } from "@/lib/duck/types";
import { DuckVoice, type StudentTurn, type VoiceEvent } from "./session";
import { httpTransport, type DuckTransport, type SpokenMove } from "./transport";

/** The five states the designer's status chips follow. */
export type DuckState = "idle" | "listening" | "thinking" | "speaking" | "paused" | "ended";

export type DuckSessionEvent =
  | { type: "state"; state: DuckState }
  | { type: "started"; start: SessionStart }
  | { type: "move"; move: SpokenMove; source: MoveSource }
  | { type: "student_turn"; turn: StudentTurn & { silenceBeforeMs: number } }
  | { type: "partial"; text: string }
  | { type: "filler" }
  | { type: "silence_armed"; steps: number[] }
  | { type: "silence_timer"; ms: number }
  | { type: "dropped_reply"; reason: string }
  /** A server call failed but the session carries on. `spoke` is true when the duck said something about it. */
  | { type: "recovering"; message: string; failures: number; spoke: boolean }
  | { type: "voice"; event: VoiceEvent }
  | { type: "error"; message: string };

/** recovery: a line the duck says itself (not from the server) because a /turn call failed. */
export type MoveSource = "opening" | "turn" | "silence" | "end" | "recovery";

export interface DuckSessionOptions {
  sectionId: string;
  topic: string;
  confidence: number;
  deviceId?: string;
  transport?: DuckTransport;
}

export const FILLER_LINE = "Hmm, let me think.";
/** Said when a /turn call fails. Under 20 words, one question, and it contains no answer. */
export const RETRY_LINE = "Sorry, I lost that. Can you say it again?";
/** Said once the server has failed several turns in a row. */
export const GIVE_UP_LINE = "I can't reach my brain right now. Let's stop here.";
const SILENCE_STEPS_MS = [DUCK.silenceRephraseMs, DUCK.silenceOfferSkipMs, DUCK.silencePauseMs];
const IDLE_WAIT_TIMEOUT_MS = 6_000;
// Moves after which the duck is not waiting for an answer, so no silence timers.
// check_in is deliberately not here: it is a proposal the student answers.
const NO_SILENCE_TIMER: SpokenMove["kind"][] = ["wrap_up", "pause"];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class DuckSession {
  private voice: DuckVoice;
  private transport: DuckTransport;
  private sessionId: string | null = null;
  private state: DuckState = "idle";

  private turnSeq = 0; // bumps each time the student starts talking; stale replies are dropped
  private duckFinishedAt: number | null = null;
  private turnSilenceMs: number | null = null;
  private armSilenceOnIdle = false;
  private awaitingAnswer = false; // the duck asked something and the student has not really answered yet
  private finishAfterIdle = false;
  private failedTurns = 0; // /turn calls that failed in a row; any success resets it

  private fillerTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimers: ReturnType<typeof setTimeout>[] = [];
  private idleWaiters: (() => void)[] = [];
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private lastStudentText: string | null = null;
  private lastStudentAt = 0;

  constructor(
    private options: DuckSessionOptions,
    private onEvent: (event: DuckSessionEvent) => void,
  ) {
    this.transport = options.transport ?? httpTransport;
    this.voice = new DuckVoice((event) => this.handleVoice(event));
  }

  get id() {
    return this.sessionId;
  }

  /** Opens the mic and Grok Voice, creates the session on the server, and speaks the opening move. */
  async start() {
    try {
      const connected = new Promise<void>((resolve, reject) => {
        this.ready = { resolve, reject };
      });
      void this.voice.start(this.options.deviceId);
      const { sectionId, topic, confidence } = this.options;
      const [start] = await Promise.all([this.transport.startSession({ sectionId, topic, confidence }), connected]);
      this.sessionId = start.sessionId;
      this.emit({ type: "started", start });
      this.deliver(start.move, "opening", { armSilence: true });
    } catch (error) {
      this.fail(error);
    }
  }

  /** The student pressed End (or the server asked to wrap up). Speaks the wrap-up, then closes. */
  async end(reason = "student_ended") {
    if (this.state === "ended") return;
    this.clearTimers();
    this.voice.hush();
    if (!this.sessionId) return this.finish();
    try {
      const move = await this.transport.endSession(this.sessionId, reason);
      this.finishAfterIdle = true;
      this.deliver(move, "end", { armSilence: false });
    } catch (error) {
      this.emit({ type: "error", message: errorMessage(error) });
      this.finish();
    }
  }

  /** Hard stop with no wrap-up. Always call this when leaving the page. */
  stop() {
    this.finish();
  }

  // ---- voice events -------------------------------------------------------

  private handleVoice(event: VoiceEvent) {
    this.emit({ type: "voice", event });
    switch (event.type) {
      case "status":
        if (event.status === "listening") {
          this.ready?.resolve();
          this.ready = null;
          if (this.state === "idle") this.setState("listening");
        } else if (event.status === "speaking") {
          this.setState("speaking", true);
        } else if (event.status === "error") {
          this.ready?.reject(new Error("Voice connection failed"));
          this.ready = null;
        }
        break;
      case "speech_started":
        this.onStudentSpeechStart();
        break;
      case "partial":
        this.emit({ type: "partial", text: event.text });
        break;
      case "turn":
        void this.onTurn(event.turn);
        break;
      case "empty_turn":
        this.onEmptyTurn();
        break;
      case "duck_idle":
        this.onDuckIdle();
        break;
      case "error":
        this.emit({ type: "error", message: event.message });
        break;
    }
  }

  private onStudentSpeechStart() {
    if (this.state === "ended") return;
    // Breath, echo, or the same sentence finalizing again must not cancel an in-flight /turn.
    // A real new utterance is handled in onTurn.
    if (this.state === "thinking") {
      this.clearSilenceTimers();
      this.clearFiller();
      return;
    }
    this.turnSeq++; // anything the server is still working on is now out of date
    this.clearSilenceTimers();
    this.clearFiller();
    if (this.turnSilenceMs === null) {
      this.turnSilenceMs = this.duckFinishedAt === null ? 0 : Date.now() - this.duckFinishedAt;
    }
    this.armSilenceOnIdle = false;
    this.setState("listening"); // also resumes from "paused"
  }

  private onEmptyTurn() {
    // Noise is not an answer: the silence clock keeps running from when the duck stopped.
    this.turnSilenceMs = null;
    if (!this.awaitingAnswer || this.isEnded()) return;
    if (this.state === "listening" && this.duckFinishedAt !== null) {
      this.startSilenceTimers(Date.now() - this.duckFinishedAt);
    }
  }

  private async onTurn(turn: StudentTurn) {
    if (!this.sessionId || this.state === "ended") return;
    const normalized = turn.text.trim().toLowerCase();
    const echoed =
      this.lastStudentText !== null &&
      this.lastStudentText === normalized &&
      Date.now() - this.lastStudentAt < 5_000;
    if (echoed) return;
    if (this.state === "thinking") this.turnSeq++;
    this.lastStudentText = normalized;
    this.lastStudentAt = Date.now();
    this.awaitingAnswer = false;
    const sessionId = this.sessionId;
    const seq = this.turnSeq;
    const silenceBeforeMs = this.turnSilenceMs ?? 0;
    this.turnSilenceMs = null;
    this.emit({ type: "student_turn", turn: { ...turn, silenceBeforeMs } });
    this.setState("thinking");

    let fillerSpoken = false;
    this.fillerTimer = setTimeout(() => {
      fillerSpoken = true;
      this.emit({ type: "filler" });
      this.voice.speak(FILLER_LINE); // once per turn, by construction
    }, DUCK.fillerAfterMs);

    let move: SpokenMove;
    try {
      move = await this.transport.sendTurn(sessionId, { ...turn, silenceBeforeMs });
    } catch (error) {
      this.clearFiller();
      if (fillerSpoken) await this.waitForIdle();
      await this.recoverFromFailedTurn(error, seq, sessionId);
      return;
    }
    this.failedTurns = 0;
    this.clearFiller();

    if (fillerSpoken) await this.waitForIdle();
    if (seq !== this.turnSeq || this.isEnded()) {
      this.emit({ type: "dropped_reply", reason: "student spoke again before the reply was ready" });
      return;
    }
    this.deliver(move, "turn", { armSilence: true });
  }

  private onDuckIdle() {
    this.duckFinishedAt = Date.now();
    for (const waiter of this.idleWaiters.splice(0)) waiter();
    if (this.finishAfterIdle) return this.finish();
    if (this.state === "speaking") this.setState("listening", true);
    if (this.armSilenceOnIdle) {
      this.armSilenceOnIdle = false;
      this.startSilenceTimers();
    }
  }

  /**
   * /turn failed or timed out. The duck must never go quiet: it says it lost that and listens again
   * (the silence timers re-arm as after any question). After several failures in a row it says so,
   * tries to close the session on the server, and stops.
   */
  private async recoverFromFailedTurn(error: unknown, seq: number, sessionId: string) {
    this.failedTurns++;
    const message = errorMessage(error);
    // The student already started talking again: their new words win, nothing to apologise for.
    if (seq !== this.turnSeq || this.isEnded()) {
      this.emit({ type: "recovering", message, failures: this.failedTurns, spoke: false });
      return;
    }

    if (this.failedTurns >= VOICE.maxFailedTurnsInARow) {
      this.emit({ type: "recovering", message, failures: this.failedTurns, spoke: true });
      this.emit({ type: "error", message: `The server failed ${this.failedTurns} turns in a row: ${message}` });
      void this.transport.endSession(sessionId, "server_unreachable").catch(() => {});
      this.finishAfterIdle = true;
      this.clearSilenceTimers();
      this.awaitingAnswer = false;
      this.armSilenceOnIdle = false;
      this.emit({ type: "move", move: this.ownMove("wrap_up", GIVE_UP_LINE), source: "recovery" });
      this.setState("speaking");
      this.voice.speak(GIVE_UP_LINE);
      return;
    }

    this.emit({ type: "recovering", message, failures: this.failedTurns, spoke: true });
    this.deliver(this.ownMove("rephrase", RETRY_LINE), "recovery", { armSilence: true });
  }

  /** A move the browser makes by itself. It carries no concept, since the server did not choose it. */
  private ownMove(kind: SpokenMove["kind"], line: string): SpokenMove {
    return { kind, level: "L0", conceptId: "", line, sessionState: "active", concepts: [] };
  }

  // ---- speaking a move ----------------------------------------------------

  private deliver(move: SpokenMove, source: MoveSource, opts: { armSilence: boolean }) {
    this.emit({ type: "move", move, source });
    this.duckFinishedAt = null;
    const followUp = move.then;
    this.armSilenceOnIdle = opts.armSilence && !NO_SILENCE_TIMER.includes(move.kind) && !followUp;
    if (opts.armSilence) this.awaitingAnswer = this.armSilenceOnIdle || Boolean(followUp);
    if (move.sessionState === "paused" || move.kind === "pause") {
      this.awaitingAnswer = false;
      this.clearSilenceTimers();
      this.armSilenceOnIdle = false;
      this.voice.speak(move.line);
      this.setState("paused");
      return;
    }
    // Only the closing summary returned by /end finishes the session.
    if (source === "end") this.finishAfterIdle = true;
    this.setState("speaking");
    this.voice.speak(move.line);

    if (followUp) {
      void this.speakFollowUp(move, source);
    } else if (move.kind === "wrap_up" && source !== "end") {
      void this.closeAfterProposal();
    }
  }

  /** celebrate: speak the line, wait for the audio to end plus afterCelebrationMs, then the next line. */
  private async speakFollowUp(move: SpokenMove, source: MoveSource) {
    const seq = this.turnSeq;
    await this.waitForIdle();
    await sleep(DUCK.afterCelebrationMs);
    if (seq !== this.turnSeq || this.isEnded() || !move.then) return; // the student spoke; their words win
    this.deliver(move.then, source, { armSilence: true });
  }

  /** wrap_up from /turn or /silence: speak it, then call /end, speak the summary, then finish. */
  private async closeAfterProposal() {
    await this.waitForIdle();
    if (this.isEnded()) return;
    await this.end("wrap_up");
  }

  // ---- silence timers (8 s rephrase, 20 s offer skip, 45 s pause) ----------

  /** `elapsedMs` is quiet time that has already passed since the duck stopped talking. */
  private startSilenceTimers(elapsedMs = 0) {
    this.clearSilenceTimers();
    const steps = SILENCE_STEPS_MS.filter((ms) => ms > elapsedMs);
    this.silenceTimers = steps.map((ms) => setTimeout(() => void this.onSilence(ms), ms - elapsedMs));
    this.emit({ type: "silence_armed", steps });
  }

  private async onSilence(ms: number) {
    if (!this.sessionId || this.state === "ended" || this.state === "thinking") return;
    this.emit({ type: "silence_timer", ms });
    try {
      const move = await this.transport.sendSilence(this.sessionId, ms);
      if (!move) return; // 409: nothing to say right now, not an error
      // The student may have spoken while we waited; their words win.
      if (this.silenceTimers.length === 0) return;
      // Later timers are already running from the original pause, so do not restart them.
      this.deliver(move, "silence", { armSilence: false });
    } catch (error) {
      // A missed silence prompt is not worth interrupting the student for; the next timer tries again.
      this.emit({ type: "recovering", message: errorMessage(error), failures: this.failedTurns, spoke: false });
    }
  }

  // ---- helpers ------------------------------------------------------------

  private waitForIdle() {
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, IDLE_WAIT_TIMEOUT_MS);
      this.idleWaiters.push(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  private clearFiller() {
    if (this.fillerTimer) clearTimeout(this.fillerTimer);
    this.fillerTimer = null;
  }

  private clearSilenceTimers() {
    this.silenceTimers.forEach(clearTimeout);
    this.silenceTimers = [];
  }

  private clearTimers() {
    this.clearFiller();
    this.clearSilenceTimers();
  }

  /**
   * `soft` is for changes that come from audio playing or stopping. Those must not pull the session
   * out of "thinking" (the filler line plays while we wait) or "paused" (only the student ends a pause).
   */
  private setState(state: DuckState, soft = false) {
    if (this.state === "ended" && state !== "ended") return;
    if (soft && (this.state === "thinking" || this.state === "paused")) return;
    if (this.state === state) return;
    this.state = state;
    this.emit({ type: "state", state });
  }

  private isEnded() {
    return this.state === "ended";
  }

  private finish() {
    this.clearTimers();
    this.finishAfterIdle = false;
    this.voice.stop();
    for (const waiter of this.idleWaiters.splice(0)) waiter();
    this.setState("ended");
  }

  private fail(error: unknown) {
    this.emit({ type: "error", message: errorMessage(error) });
    this.finish();
  }

  private emit(event: DuckSessionEvent) {
    this.onEvent(event);
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
