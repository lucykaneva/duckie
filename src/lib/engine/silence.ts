import { DUCK } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type { DuckMove, MoveKind } from "../duck/types";
import { isQuestionMove } from "./brakes";
import { addSignals } from "./score";
import type { SignalKind } from "./signals";
import type { ConceptRun, SessionRun } from "./turn";
import { OFFER_SKIP_LINE, PAUSE_LINE } from "./wording";

// The silence brakes (spec section 5): after a question, 8 s of quiet rephrases it,
// 20 s offers to skip, 45 s pauses the session. Dev A's timers call POST /silence at each step.

export type SilenceStep = 1 | 2 | 3;

/** Which brake a silence of `ms` has reached; null if it is shorter than the first. */
export function silenceStepFor(
  ms: number,
  config: Pick<DuckConfig, "silenceRephraseMs" | "silenceOfferSkipMs" | "silencePauseMs"> = DUCK,
): SilenceStep | null {
  if (ms >= config.silencePauseMs) return 3;
  if (ms >= config.silenceOfferSkipMs) return 2;
  if (ms >= config.silenceRephraseMs) return 1;
  return null;
}

export interface SilenceOutcome {
  session: SessionRun;
  move: DuckMove;
  /** ["silence"] when the 8 s signal counted. */
  signals: SignalKind[];
  scoreAfter: number;
}

const isOpenConcept = (c: ConceptRun): boolean =>
  !c.skipped && (c.state === "not_yet" || c.state === "misconception");

/**
 * Handle one silence step. Returns null when there is nothing to do: the session is closing or
 * paused, or this step (or a later one) was already handled since the student last spoke.
 * Pure; the caller loads and saves state.
 */
export function processSilence(
  session: SessionRun,
  step: SilenceStep,
  nowMs: number,
  config: DuckConfig = DUCK,
): SilenceOutcome | null {
  if (session.closing || session.pausedAtMs !== null) return null;
  if (step <= session.silenceStep) return null;

  const concepts: ConceptRun[] = session.concepts.map((c) => ({ ...c }));
  const focusRun = concepts.find((c) => c.conceptId === session.focusConceptId);
  const focus = focusRun && isOpenConcept(focusRun) ? focusRun : undefined;
  const conceptId = session.focusConceptId ?? concepts[0]?.conceptId ?? "";
  const progress = concepts.map((c) => ({ id: c.conceptId, state: c.state, score: c.score }));

  const signals: SignalKind[] = [];
  // The 8 s signal counts once per student turn, at the first silence step that is handled.
  // Only a content question can be "left unanswered"; a skip offer or check-in is not one.
  const last = session.lastMoveKind;
  if (focus && session.silenceStep === 0 && session.pending === null && last !== null && isQuestionMove(last)) {
    focus.score = addSignals(focus.score, ["silence"], config);
    signals.push("silence");
  }

  const sessionState = session.pending === "wrap_proposal" ? "wrapping_up" : "active";
  const base: SessionRun = { ...session, concepts, silenceStep: step };
  const scoreAfter = focus?.score ?? 0;

  if (step === 3) {
    const move: DuckMove = {
      kind: "pause",
      level: focus?.levelReached ?? "L0",
      conceptId,
      line: PAUSE_LINE,
      sessionState: "paused",
      concepts: progress,
    };
    // lastMoveKind and lastLine stay as they were so the question comes back after the pause.
    return { session: { ...base, pausedAtMs: nowMs }, move, signals, scoreAfter };
  }

  // 20 s: offer to skip the concept the duck is waiting on, unless it is waiting on a check-in.
  if (step === 2 && focus && session.pending === null) {
    const move: DuckMove = {
      kind: "offer_skip",
      level: focus.levelReached,
      conceptId,
      line: OFFER_SKIP_LINE,
      sessionState: "active",
      concepts: progress,
    };
    return {
      session: { ...base, lastMoveKind: "offer_skip", lastLine: OFFER_SKIP_LINE, questionStreak: 0 },
      move,
      signals,
      scoreAfter,
    };
  }

  // 8 s (and 20 s when there is nothing to skip): say the same thing again, same level.
  // Dev A's wordMove phrases the rephrase differently in B11; until then the line is repeated.
  const kind: MoveKind = last === null || isQuestionMove(last) ? "rephrase" : last;
  const move: DuckMove = {
    kind,
    level: focus?.levelReached ?? "L0",
    conceptId,
    line: session.lastLine,
    sessionState,
    concepts: progress,
  };
  return { session: { ...base, lastMoveKind: kind }, move, signals, scoreAfter };
}
