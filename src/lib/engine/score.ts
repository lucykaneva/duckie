import { DUCK } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type { JudgeResult } from "../duck/types";
import { detectTextSignals } from "./signals";
import type { SignalKind, TextSignalConfig } from "./signals";

/** Only the config values scoring reads (so per-user overrides can be passed in). */
export type ScoreConfig = TextSignalConfig & Pick<DuckConfig, "weights">;

/** Order signals are reported in (the order of the spec's table). */
const SIGNAL_ORDER: SignalKind[] = [
  "dontKnow",
  "wrongTrace",
  "misconception",
  "conceptMissed",
  "contradiction",
  "silence",
  "vague",
  "hedging",
  "fillers",
];

/** Everything the score needs to know about one finished student turn on one concept. */
export interface TurnEvidence {
  conceptId: string;
  /** The student's words. Empty for a silence event. */
  text?: string;
  /** Dev A's judgeTurn result for this turn. */
  judge?: JudgeResult;
  /** True only when the student's explanation turn has ended (gates "concept missed"). */
  explanationTurnEnded?: boolean;
  /** The code runner says the student's committed trace or prediction was wrong. */
  wrongTrace?: boolean;
  /** The 8 s silence timer fired after a question. */
  silence?: boolean;
  /** Correct prediction or unaided explanation. Resets the score to 0. */
  success?: boolean;
}

export interface ScoreUpdate {
  /** New score, 0 to 1. */
  score: number;
  /** Score before this turn. Celebration checks this against DUCK.earnedScore. */
  previous: number;
  /** Signals that counted this turn, each once. */
  applied: SignalKind[];
  /** True when success reset the score to 0. */
  reset: boolean;
}

/** Scores are sums of two-decimal weights; round away float noise (0.3 + 0.15 = 0.44999...). */
function clean(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** A judge quote counts only if its exact words appear in the turn text. */
export function quoteAppears(text: string, quote: string): boolean {
  const q = quote.trim();
  return q.length > 0 && text.includes(q);
}

/**
 * Signals from the judge for one concept. Any item without a quote that appears
 * verbatim in the turn text is dropped. "Missed" has nothing to quote (the student
 * did not say it), so it counts only once the explanation turn has ended.
 */
export function judgeSignals(
  conceptId: string,
  text: string,
  judge: JudgeResult | undefined,
  explanationTurnEnded: boolean,
): SignalKind[] {
  if (!judge) return [];
  const signals: SignalKind[] = [];

  if (judge.misconceptions.some((m) => m.conceptId === conceptId && quoteAppears(text, m.quote))) {
    signals.push("misconception");
  }
  if (explanationTurnEnded && judge.missed.some((m) => m.conceptId === conceptId)) {
    signals.push("conceptMissed");
  }
  if (
    judge.contradictions.some(
      (c) => c.conceptId === conceptId && c.quotes.every((quote) => quoteAppears(text, quote)),
    )
  ) {
    signals.push("contradiction");
  }
  if (judge.vague.some((v) => v.conceptId === conceptId && quoteAppears(text, v.quote))) {
    signals.push("vague");
  }
  return signals;
}

/** Every signal that fires for this turn, once each, in the spec's table order. */
export function collectSignals(
  evidence: TurnEvidence,
  config: ScoreConfig = DUCK,
): SignalKind[] {
  const text = evidence.text ?? "";
  const fired = new Set<SignalKind>([
    ...detectTextSignals(text, config),
    ...judgeSignals(evidence.conceptId, text, evidence.judge, evidence.explanationTurnEnded ?? false),
  ]);
  if (evidence.wrongTrace) fired.add("wrongTrace");
  if (evidence.silence) fired.add("silence");
  return SIGNAL_ORDER.filter((kind) => fired.has(kind));
}

/** Add signal weights to a score, each signal once, capped at 1. */
export function addSignals(
  previous: number,
  signals: Iterable<SignalKind>,
  config: Pick<ScoreConfig, "weights"> = DUCK,
): number {
  const unique = new Set(signals);
  let score = Math.max(0, previous);
  for (const kind of unique) score += config.weights[kind];
  return clean(Math.min(1, score));
}

/**
 * Update one concept's struggle score after a finished turn (or a silence event).
 * Success resets to 0 and ignores the turn's other signals.
 */
export function updateConceptScore(
  previous: number,
  evidence: TurnEvidence,
  config: ScoreConfig = DUCK,
): ScoreUpdate {
  if (evidence.success) {
    return { score: 0, previous, applied: [], reset: true };
  }
  const applied = collectSignals(evidence, config);
  return { score: addSignals(previous, applied, config), previous, applied, reset: false };
}
