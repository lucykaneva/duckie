// B12: what the session meant, after it ends. Pure. Code owns the numbers and which
// concept was the high point or the hole; Grok only words the spoken wrap-up.

import { DUCK } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type { ConceptState, Level, ResultsConcept, SessionResults } from "../duck/types";
import { inSentence, wordCount } from "./wording";
import type { ConceptDef, ConceptRun } from "./turn";

const REVISE_RANK: Record<ConceptState, number> = {
  misconception: 0,
  explained_to: 1,
  skipped: 2,
  not_yet: 3,
  assisted: 4,
  owned: 5,
};

const STRONG_RANK: Record<ConceptState, number> = {
  owned: 0,
  assisted: 1,
  explained_to: 2,
  misconception: 3,
  skipped: 4,
  not_yet: 5,
};

export interface QuoteForConcept {
  conceptId: string;
  text: string;
}

export interface ExistingRecall {
  conceptId: string;
  stateAfter: ConceptState;
  intervalDays: number;
  successes: number;
  /** Set when the row is already written (after /end). */
  due?: string;
}

export interface RecallPlan {
  conceptId: string;
  stateAfter: ConceptState;
  intervalDays: number;
  successes: number;
  due: string;
}

export interface DebriefInput {
  sessionId: string;
  topic: string;
  confidence: number;
  defs: ConceptDef[];
  concepts: ConceptRun[];
  /** Student words, keyed by the concept the duck's reply was about. */
  quotes?: QuoteForConcept[];
  /** A celebration line already spoken this session, if any. */
  celebrationLine?: string | null;
  existingRecall?: ExistingRecall[];
  /** After /end: keep the dates already written so GET does not double the interval. */
  freezeRecall?: boolean;
  /** YYYY-MM-DD. Defaults to today UTC. */
  today?: string;
  duckLearned?: string[];
  config?: DuckConfig;
}

/** Owned counts 1, Assisted counts 0.5, everything else 0. Share of the deck, 0–100. */
export function understandingPercent(concepts: { state: ConceptState }[]): number {
  if (concepts.length === 0) return 0;
  const points = concepts.reduce((sum, c) => {
    if (c.state === "owned") return sum + 1;
    if (c.state === "assisted") return sum + 0.5;
    return sum;
  }, 0);
  return Math.round((points / concepts.length) * 100);
}

/** Felt (confidence × 20) minus understanding. Can be negative if they knew more than they felt. */
export function illusionScore(confidence: number, understanding: number): number {
  return confidence * 20 - understanding;
}

export function firstRecallDays(state: ConceptState, config: DuckConfig = DUCK): number {
  switch (state) {
    case "owned":
      return config.recallFirstDays.owned;
    case "assisted":
      return config.recallFirstDays.assisted;
    case "misconception":
      return config.recallFirstDays.misconception;
    case "explained_to":
      return config.recallFirstDays.explainedTo;
    default:
      return config.recallFirstDays.skipped;
  }
}

export function addUtcDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * First time: starting interval for the ending state.
 * Later session: owned/assisted doubles the interval (cap 30 days); anything else resets to 1 day.
 */
export function planRecall(
  conceptId: string,
  state: ConceptState,
  existing: ExistingRecall | undefined,
  today: string,
  config: DuckConfig = DUCK,
): RecallPlan {
  if (!existing) {
    const intervalDays = firstRecallDays(state, config);
    return { conceptId, stateAfter: state, intervalDays, successes: 0, due: addUtcDays(today, intervalDays) };
  }
  const success = state === "owned" || state === "assisted";
  if (!success) {
    return { conceptId, stateAfter: state, intervalDays: 1, successes: 0, due: addUtcDays(today, 1) };
  }
  const intervalDays = Math.min(existing.intervalDays * 2, config.recallMaxDays);
  return {
    conceptId,
    stateAfter: state,
    intervalDays,
    successes: existing.successes + 1,
    due: addUtcDays(today, intervalDays),
  };
}

export function pickStrongest(concepts: ConceptRun[]): ConceptRun | undefined {
  const celebrated = concepts.find((c) => c.celebrated);
  if (celebrated) return celebrated;
  const best = [...concepts].sort(
    (a, b) => STRONG_RANK[a.state] - STRONG_RANK[b.state] || a.conceptId.localeCompare(b.conceptId),
  )[0];
  if (!best || (best.state !== "owned" && best.state !== "assisted")) return undefined;
  return best;
}

/** The one hole to go back to. None when everything is owned. */
export function pickRevise(concepts: ConceptRun[]): ConceptRun | undefined {
  const hole = [...concepts].sort(
    (a, b) => REVISE_RANK[a.state] - REVISE_RANK[b.state] || a.conceptId.localeCompare(b.conceptId),
  )[0];
  if (!hole || hole.state === "owned") return undefined;
  return hole;
}

export function strongestMomentLine(name: string, celebrationLine?: string | null): string {
  const spoken = celebrationLine?.trim();
  if (spoken && wordCount(spoken) <= DUCK.maxDuckWords) return spoken.replace(/[.!?]+$/, ".");
  return `Your best bit was ${inSentence(name)}.`;
}

/** Safe 20-word wrap-up if Grok is down. No scores. */
export function wrapSummaryLine(strongest: string, revise: string | undefined): string {
  const found = strongest.replace(/[.!?]+$/, ".");
  if (!revise) {
    const clear = `${found} That's everything.`;
    return wordCount(clear) <= DUCK.maxDuckWords ? clear : found;
  }
  const full = `${found} Next time we can try ${inSentence(revise)}.`;
  if (wordCount(full) <= DUCK.maxDuckWords) return full;
  const short = `Next time we can try ${inSentence(revise)}.`;
  return wordCount(short) <= DUCK.maxDuckWords ? short : "We can try the hard part again next time.";
}

function quotesFor(conceptId: string, quotes: QuoteForConcept[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of quotes) {
    if (q.conceptId !== conceptId) continue;
    const text = q.text.replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length === 3) break;
  }
  return out;
}

export function buildDebrief(input: DebriefInput): {
  results: SessionResults;
  recall: RecallPlan[];
  wrapLine: string;
  situation: string;
} {
  const config = input.config ?? DUCK;
  const today = input.today ?? todayUtc();
  const quotes = input.quotes ?? [];
  const existing = new Map((input.existingRecall ?? []).map((r) => [r.conceptId, r]));
  const byId = new Map(input.defs.map((d) => [d.id, d]));

  const understanding = understandingPercent(input.concepts);
  const illusion = illusionScore(input.confidence, understanding);
  const strongest = pickStrongest(input.concepts);
  const revise = pickRevise(input.concepts);
  const strongestName = strongest ? (byId.get(strongest.conceptId)?.name ?? "that") : "that";
  const reviseName = revise ? byId.get(revise.conceptId)?.name : undefined;
  const strongestMoment = strongest
    ? strongestMomentLine(strongestName, input.celebrationLine)
    : "We didn't get far.";
  const reviseNext = reviseName ?? "You're clear for now.";
  const wrapLine = strongest
    ? wrapSummaryLine(strongestMoment, reviseName)
    : reviseName
      ? "Let's try again when you want to teach."
      : "Okay. I'll be here when you're ready.";

  const recall = input.concepts.map((c) => {
    const prev = existing.get(c.conceptId);
    if (input.freezeRecall && prev?.due) {
      return {
        conceptId: c.conceptId,
        stateAfter: c.state,
        intervalDays: prev.intervalDays,
        successes: prev.successes,
        due: prev.due,
      };
    }
    return planRecall(c.conceptId, c.state, prev, today, config);
  });

  const results: SessionResults = {
    sessionId: input.sessionId,
    topic: input.topic,
    confidence: input.confidence,
    understanding,
    illusionScore: illusion,
    strongestMoment,
    reviseNext,
    concepts: input.concepts.map((c): ResultsConcept => {
      const def = byId.get(c.conceptId);
      return {
        id: c.conceptId,
        name: def?.name ?? c.conceptId,
        state: c.state,
        levelReached: (c.levelReached ?? "L0") as Level,
        slide: def?.slide ?? 0,
        quotes: quotesFor(c.conceptId, quotes),
      };
    }),
    duckLearned: input.duckLearned ?? [],
    recall: recall.map((r) => ({ conceptId: r.conceptId, due: r.due })),
  };

  const owned = input.concepts.filter((c) => c.state === "owned").map((c) => byId.get(c.conceptId)?.name ?? c.conceptId);
  const holes = input.concepts
    .filter((c) => c.state !== "owned")
    .map((c) => `${byId.get(c.conceptId)?.name ?? c.conceptId} (${c.state})`);

  const situation = [
    `The student just finished teaching you ${input.topic} out loud.`,
    `They felt ${input.confidence} out of 5 sure. Understanding ${understanding}. Illusion score ${illusion}.`,
    owned.length ? `They got: ${owned.join(", ")}.` : "They did not own a concept yet.",
    holes.length ? `Still shaky: ${holes.join(", ")}.` : "Nothing shaky left.",
    `Strongest moment to name: ${strongestMoment}`,
    `One idea to revisit: ${reviseNext}`,
  ].join("\n");

  return { results, recall, wrapLine, situation };
}
