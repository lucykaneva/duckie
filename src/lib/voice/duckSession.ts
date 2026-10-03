// Browser-only. The whole duck loop in one place: this is what the session page (and /dev/voice) uses.
// Code on the server decides every move; this class only listens, sends turns, and speaks the line back.
import { DUCK } from "@/lib/duck/config";
import type { DuckMove, SessionStart } from "@/lib/duck/types";
import { DuckVoice, type StudentTurn, type VoiceEvent } from "./session";
import { httpTransport, type DuckTransport } from "./transport";

/** The five states the designer's status chips follow. */
export type DuckState = "idle" | "listening" | "thinking" | "speaking" | "paused" | "ended";

export type DuckSessionEvent =
  | { type: "state"; state: DuckState }
  | { type: "started"; start: SessionStart }
  | { type: "move"; move: DuckMove; source: "opening" | "turn" | "silence" | "end" }
  | { type: "student_turn"; turn: StudentTurn & { silenceBeforeMs: number } }
  | { type: "partial"; text: string }
  | { type: "filler" }
  | { type: "silence_timer"; ms: number }
  | { type: "dropped_reply"; reason: string }
  | { type: "voice"; event: VoiceEvent }
  | { type: "error"; message: string };

export interface DuckSessionOptions {
  sectionId: string;
  topic: string;
  confidence: number;
  deviceId?: string;
  transport?: DuckTransport;
}

export const FILLER_LINE = "Hmm, let me think.";
const SILENCE_STEPS_MS = [DUCK.silenceRephraseMs, DUCK.silenceOfferSkipMs, DUCK.silencePauseMs];
const IDLE_WAIT_TIMEOUT_MS = 6_000;
// Moves after which the duck is not waiting for an answer, so no silence timers.
const NO_SILENCE_TIMER: DuckMove["kind"][] = ["wrap_up", "pause"];

export class DuckSession {
  private voice: DuckVoice;
  private transport: DuckTransport;
  private sessionId: string | null = null;
  private state: DuckState = "idle";

  private turnSeq = 0; // bumps each time the student starts talking; stale replies are dropped
  private duckFinishedAt: number | null = null;
  private turnSilenceMs: number | null = null;
  private armSilenceOnIdle = false;
  private finishAfterIdle = false;

  private fillerTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimers: ReturnType<typeof setTimeout>[] = [];
  private idleWaiters: (() => void)[] = [];
  private ready: { resolve: () => void; reject: (error: Error) => void } | null = null;

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
    this.turnSeq++; // anything the server is still working on is now out of date
    this.clearSilenceTimers();
    this.clearFiller();
    if (this.turnSilenceMs === null) {
      this.turnSilenceMs = this.duckFinishedAt === null ? 0 : Date.now() - this.duckFinishedAt;
    }
    this.armSilenceOnIdle = false;
    this.setState("listening"); // also resumes from "paused"
  }

  private async onTurn(turn: StudentTurn) {
    if (!this.sessionId || this.state === "ended") return;
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

    let move: DuckMove;
    try {
      move = await this.transport.sendTurn(sessionId, { ...turn, silenceBeforeMs });
    } catch (error) {
      this.clearFiller();
      this.emit({ type: "error", message: errorMessage(error) });
      this.setState("listening");
      return;
    }
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

  // ---- speaking a move ----------------------------------------------------

  private deliver(move: DuckMove, source: "opening" | "turn" | "silence" | "end", opts: { armSilence: boolean }) {
    this.emit({ type: "move", move, source });
    this.duckFinishedAt = null;
    this.armSilenceOnIdle = opts.armSilence && !NO_SILENCE_TIMER.includes(move.kind);
    if (move.sessionState === "paused" || move.kind === "pause") {
      this.clearSilenceTimers();
      this.armSilenceOnIdle = false;
      this.voice.speak(move.line);
      this.setState("paused");
      return;
    }
    if (move.kind === "wrap_up") this.finishAfterIdle = true;
    this.setState("speaking");
    this.voice.speak(move.line);
  }

  // ---- silence timers (8 s rephrase, 20 s offer skip, 45 s pause) ----------

  private startSilenceTimers() {
    this.clearSilenceTimers();
    this.silenceTimers = SILENCE_STEPS_MS.map((ms) => setTimeout(() => void this.onSilence(ms), ms));
  }

  private async onSilence(ms: number) {
    if (!this.sessionId || this.state === "ended" || this.state === "thinking") return;
    this.emit({ type: "silence_timer", ms });
    try {
      const move = await this.transport.sendSilence(this.sessionId, ms);
      // The student may have spoken while we waited; their words win.
      if (this.silenceTimers.length === 0) return;
      // Later timers are already running from the original pause, so do not restart them.
      this.deliver(move, "silence", { armSilence: false });
    } catch (error) {
      this.emit({ type: "error", message: errorMessage(error) });
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
