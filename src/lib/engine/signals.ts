import { DUCK, ENGINE } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import {
  AFFIRMATIVE_PATTERN,
  CLARIFY_PATTERNS,
  COMPLAINT_ABOUT_DUCK,
  EXPLAIN_REQUEST_PATTERNS,
  DONT_KNOW_PATTERNS,
  FRUSTRATION_PATTERNS,
  READY_PATTERNS,
  TIRED_PATTERNS,
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

/** Sentences long enough to be their own claim, with indexes into the original text. */
export function claimSpans(text: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  for (const match of text.matchAll(/[^.?!]+[.?!]*/g)) {
    const slice = match[0];
    if (tokenize(slice).length < ENGINE.laterClaimMinWords) continue;
    const start = match.index ?? 0;
    spans.push({ start, end: start + slice.length });
  }
  return spans;
}

/** The turn states one claim, then a later one. The later one is what they actually landed on. */
export function endsWithLaterClaim(text: string): boolean {
  return claimSpans(text).length >= 2;
}

/** The quote sits in a claim after the first one, so it is the ending, not the opening. */
export function quoteInLaterClaim(text: string, quote: string): boolean {
  const spans = claimSpans(text);
  if (spans.length < 2) return false;
  const at = text.indexOf(quote);
  return at !== -1 && at >= spans[1].start;
}

/** "I don't know", "no idea", "not sure at all" and close variants. */
export function detectDontKnow(text: string): boolean {
  const t = normalize(text);
  return DONT_KNOW_PATTERNS.some((pattern) => pattern.test(t));
}

/** "Okay, let's do that." Agreement to start, not an answer to a question. */
export function detectReady(text: string): boolean {
  const t = normalize(text);
  return READY_PATTERNS.some((pattern) => pattern.test(t));
}

/** "I just said that." The duck asked again and they noticed. */
export function detectFrustration(text: string): boolean {
  const t = normalize(text);
  return FRUSTRATION_PATTERNS.some((pattern) => pattern.test(t));
}

/** "I'm tired." They want to stop the session, not skip the current idea. */
export function detectTired(text: string): boolean {
  const t = normalize(text);
  return TIRED_PATTERNS.some((pattern) => pattern.test(t));
}

/**
 * The whole turn is agreement ("okay", "let's do that"), not an answer.
 * A longer turn, a question, or "I don't know" is the student actually talking.
 */
export function isOnlyReady(text: string): boolean {
  if (!text.trim()) return false;
  if (
    detectDontKnow(text) ||
    detectHelpRequest(text) ||
    detectQuestion(text) ||
    detectMoveOn(text) ||
    detectWrapUpRequest(text) ||
    detectFrustration(text) ||
    detectTired(text)
  ) {
    return false;
  }
  if (tokenize(text).length > ENGINE.readyTurnMaxWords) return false;
  return detectReady(text) || detectAffirmative(text);
}

/** The claim with "is fine" stripped, so "lo = mid is fine" is "lo = mid". */
function claimCore(misconception: string): string {
  return normalize(misconception)
    .replace(/\bequals\b/g, "=")
    .replace(/\s*=\s*/g, " = ")
    .replace(/\b(?:is|are)\s+(?:fine|okay|ok|alright|all right|wrong|bad)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The student named this stored wrong belief ("lo equals mid"). */
export function mentionsClaim(text: string, misconception: string): boolean {
  const core = claimCore(misconception);
  if (core.length < 3) return false;
  const hay = normalize(text).replace(/\bequals\b/g, "=").replace(/\s*=\s*/g, " = ");
  return hay.includes(core);
}

/**
 * They spotted the failure themselves ("it loops forever"), rather than agreeing the wrong claim is fine.
 * A bare "no" does not count: "no idea" is being lost, not catching the bug.
 */
export function caughtPlantedMistake(text: string): boolean {
  if (plantedAgreementQuote(text)) return false;
  const t = normalize(text);
  return (
    /\b(?:loops?|forever|infinite)\b/.test(t) ||
    /\bnever (?:moves?|stops?|ends?)\b/.test(t) ||
    /\bnot (?:fine|okay|ok|alright)\b/.test(t) ||
    /\b(?:that(?:'s| is)|it(?:'s| is)) (?:wrong|incorrect)\b/.test(t)
  );
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
  if (COMPLAINT_ABOUT_DUCK.test(t)) return false;
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
