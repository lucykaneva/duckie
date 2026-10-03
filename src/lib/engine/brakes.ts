import type { DuckConfig } from "../duck/config";
import type { MoveKind } from "../duck/types";

// The pure decisions behind the brakes (spec section 5). turn.ts and silence.ts call these.

/** A duck move that asks the student a content question. Offers, check-ins and prompts are not "questions" here. */
export function isQuestionMove(kind: MoveKind): boolean {
  return kind === "question" || kind === "rephrase";
}

/**
 * The question streak after a duck move. A move that opens with an acknowledgement or
 * follows a celebration starts a new run (the student has been answered); any move
 * that is not a content question ends the run.
 */
export function nextStreak(previous: number, kind: MoveKind, afterResponse: boolean): number {
  if (!isQuestionMove(kind)) return 0;
  return afterResponse ? 1 : previous + 1;
}

/** After `maxQuestionStreak` back-to-back questions the next question becomes an open prompt. */
export function mustOpenUp(
  streak: number,
  plannedKind: MoveKind,
  afterResponse: boolean,
  config: Pick<DuckConfig, "maxQuestionStreak">,
): boolean {
  return !afterResponse && isQuestionMove(plannedKind) && streak >= config.maxQuestionStreak;
}

export type SessionLimit = "time" | "concepts";

/** 8 minutes of active time (pauses excluded) or 6 concepts finished, whichever comes first. */
export function sessionLimit(
  finishedConcepts: number,
  activeMs: number,
  config: Pick<DuckConfig, "sessionMaxMs" | "sessionMaxConcepts">,
): SessionLimit | null {
  if (activeMs >= config.sessionMaxMs) return "time";
  if (finishedConcepts >= config.sessionMaxConcepts) return "concepts";
  return null;
}

/** After this many skips the duck asks once whether to keep going. */
export function skipCheckInDue(
  skips: number,
  alreadyAsked: boolean,
  config: Pick<DuckConfig, "skipsBeforeCheckIn">,
): boolean {
  return !alreadyAsked && skips >= config.skipsBeforeCheckIn;
}
