import { DUCK, ENGINE } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import {
  AFFIRMATIVE_PATTERN,
  CLARIFY_PATTERNS,
  EXPLAIN_REQUEST_PATTERNS,
  DONT_KNOW_PATTERNS,
  FILLER_WORD,
  HEDGE_PATTERNS,
  HELP_REQUEST_PATTERNS,
  KEEP_GOING_PATTERNS,
  MOVE_ON_PATTERNS,
  NOT_FILLER_PAIRS,
  PLANTED_AGREE_PATTERNS,
  PLANTED_REJECT_PATTERNS,
  QUESTION_START_PATTERN,
  WRAP_UP_PATTERNS,
} from "./phrases";

/** The signals in the spec's table. Keys match DUCK.weights. */
export type SignalKind = keyof DuckConfig["weights"];

/** Only the config values the text detectors read (so per-user overrides can be passed in). */
export type TextSignalConfig = Pick<DuckConfig, "hedgingMinPerTurn" | "fillerWordsPerUm">;

/** Lowercase, straight apostrophes, single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Words as the spoken-word rate sees them: letters, digits and apostrophes. */
export function tokenize(text: string): string[] {
  return normalize(text).match(/[\p{L}\p{N}']+/gu) ?? [];
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

/** "I don't know", "no idea", "not sure at all" and close variants. */
export function detectDontKnow(text: string): boolean {
  const t = normalize(text);
  return DONT_KNOW_PATTERNS.some((pattern) => pattern.test(t));
}

/** How many hedges ("I think", "maybe", "kind of", "or something") are in the turn. */
export function countHedges(text: string): number {
  const t = normalize(text);
  return HEDGE_PATTERNS.reduce((sum, pattern) => sum + (t.match(pattern)?.length ?? 0), 0);
}

/** 2 or more hedges in one turn (DUCK.hedgingMinPerTurn). */
export function detectHedging(text: string, config: TextSignalConfig = DUCK): boolean {
  return countHedges(text) >= config.hedgingMinPerTurn;
}

/** How many "um" / "uh" fillers are in the turn. */
export function countFillers(text: string): number {
  const fillers = tokenize(text).filter((word) => FILLER_WORD.test(word)).length;
  const notFillers = normalize(text).match(NOT_FILLER_PAIRS)?.length ?? 0;
  return Math.max(0, fillers - notFillers);
}

/**
 * More than 1 filler per DUCK.fillerWordsPerUm (8) words.
 * fillers / words > 1 / 8  is the same as  fillers * 8 > words.
 */
export function detectHeavyFillers(text: string, config: TextSignalConfig = DUCK): boolean {
  const fillers = countFillers(text);
  if (fillers === 0) return false;
  return fillers * config.fillerWordsPerUm > countWords(text);
}

/** "Let's move on", "skip this one". Not "then you skip the left half". */
export function detectMoveOn(text: string): boolean {
  const t = normalize(text);
  return MOVE_ON_PATTERNS.some((pattern) => pattern.test(t));
}

/** "Let's wrap up", "I'm done". Never fires inside an explanation. */
export function detectWrapUpRequest(text: string): boolean {
  const t = normalize(text);
  return WRAP_UP_PATTERNS.some((pattern) => pattern.test(t));
}

/** "Keep going", "one more", "no". Only meaningful right after a check-in or a wrap-up proposal. */
export function detectKeepGoing(text: string): boolean {
  const t = normalize(text);
  return KEEP_GOING_PATTERNS.some((pattern) => pattern.test(t));
}

/** A plain "yes" or "okay" (the whole turn). Only meaningful right after the duck offers to skip. */
export function detectAffirmative(text: string): boolean {
  return AFFIRMATIVE_PATTERN.test(normalize(text));
}

/**
 * The student agreed with a planted wrong claim. Only meaningful when the duck just asked one.
 * Returns the student's words to use as the misconception quote, or null.
 */
export function plantedAgreementQuote(text: string): string | null {
  const t = normalize(text);
  if (PLANTED_REJECT_PATTERNS.some((pattern) => pattern.test(t))) return null;
  if (!PLANTED_AGREE_PATTERNS.some((pattern) => pattern.test(t))) return null;
  const trimmed = text.trim();
  return trimmed || null;
}

/** "What do you mean by pebbles?", "say that again". Asks about the duck's last line; never a struggle signal. */
export function detectClarification(text: string): boolean {
  const t = normalize(text);
  return CLARIFY_PATTERNS.some((pattern) => pattern.test(t));
}

/** The student asked something. The duck cannot answer it, and it is not an answer to the duck either. */
export function detectQuestion(text: string): boolean {
  const t = normalize(text);
  return t.includes("?") || QUESTION_START_PATTERN.test(t);
}

/**
 * The student asked the duck a real question ("Is it log n?", "Why does that work?"), not an explanation that
 * happens to end in "right?". Starts with a question word, one sentence, and short. A question means they
 * need help, so the engine treats it like asking for a hint.
 */
export function detectAskingQuestion(text: string): boolean {
  const t = normalize(text);
  if (detectClarification(text) || !QUESTION_START_PATTERN.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean).length;
  const marks = (t.match(/\?/g) ?? []).length;
  if (marks > 1 || words > ENGINE.questionMaxWords) return false;
  if (marks === 1) return t.endsWith("?");
  return words <= ENGINE.questionNoMarkMaxWords;
}

/** "Can you explain it?" Asking to be explained to (not a hint request). */
export function detectExplainRequest(text: string): boolean {
  const t = normalize(text);
  return EXPLAIN_REQUEST_PATTERNS.some((pattern) => pattern.test(t));
}

/** "Can you explain it?" A request for help, never a struggle signal. */
export function detectHelpRequest(text: string): boolean {
  const t = normalize(text);
  return HELP_REQUEST_PATTERNS.some((pattern) => pattern.test(t));
}

/** The signals code can read straight from the turn text. */
export function detectTextSignals(
  text: string,
  config: TextSignalConfig = DUCK,
): SignalKind[] {
  const signals: SignalKind[] = [];
  if (detectDontKnow(text)) signals.push("dontKnow");
  if (detectHedging(text, config)) signals.push("hedging");
  if (detectHeavyFillers(text, config)) signals.push("fillers");
  return signals;
}
