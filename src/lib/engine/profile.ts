// B13: the learner profile. Code owns the config numbers and the quote check.
// summarizeProfile (Dev A, A11) may write the prose; if it is missing, slow, or invents a
// line without a student quote, this file finishes a safe profile from the turn log.

import { DUCK, PROFILE } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type { ConceptState, MoveKind, Profile, TurnLogRow } from "../duck/types";
import { findQuote } from "../prompts/quotes";
import { understandingPercent, illusionScore } from "./debrief";

const MID_THOUGHT = /(?:^|[^a-z])(and|so|because|like|um|uh)\s*[.?!]*\s*$/i;

export interface ProfileFacts {
  skipCount: number;
  unfinishedTurns: number;
  studentTurns: number;
  hedgingTurns: number;
  illusion: number;
  overconfident: boolean;
  pausesMidThought: boolean;
  skipsOften: boolean;
}

export function profileFacts(input: {
  concepts: { state: ConceptState; skipped: boolean }[];
  turns: { text: string; signals: string[] }[];
  confidence: number;
}): ProfileFacts {
  const student = input.turns.filter((t) => t.text.trim());
  const skipCount = input.concepts.filter((c) => c.skipped || c.state === "skipped").length;
  const unfinishedTurns = student.filter((t) => MID_THOUGHT.test(t.text.trim())).length;
  const hedgingTurns = student.filter((t) => t.signals.includes("hedging")).length;
  const understanding = understandingPercent(input.concepts);
  const illusion = illusionScore(input.confidence, understanding);
  return {
    skipCount,
    unfinishedTurns,
    studentTurns: student.length,
    hedgingTurns,
    illusion,
    overconfident: illusion >= PROFILE.calibrationGap,
    pausesMidThought: unfinishedTurns >= 2 || (student.length > 0 && unfinishedTurns / student.length >= 0.4),
    skipsOften: skipCount >= 2,
  };
}

/** Clamp a number to ±band of the default. Integers stay integers. */
export function clampToDefault(value: number, base: number, band = PROFILE.maxOverridePct): number {
  if (!Number.isFinite(value) || !Number.isFinite(base)) return base;
  const lo = base * (1 - band);
  const hi = base * (1 + band);
  const clamped = Math.min(hi, Math.max(lo, value));
  return Number.isInteger(base) ? Math.round(clamped) : Math.round(clamped * 1e6) / 1e6;
}

/**
 * Code-owned overrides from this session. Pace waits longer after mid-thought pauses.
 * Nagginess raises L1 and drops the move cap. Overconfidence lowers the ladder so the duck probes sooner.
 */
export function proposedOverrides(facts: ProfileFacts, base: DuckConfig = DUCK): Partial<DuckConfig> {
  const out: Partial<DuckConfig> = {};
  if (facts.pausesMidThought) {
    out.endOfTurnSilenceMs = clampToDefault(base.endOfTurnSilenceMs * (1 + PROFILE.maxOverridePct), base.endOfTurnSilenceMs);
    out.unfinishedThoughtWaitMs = clampToDefault(
      base.unfinishedThoughtWaitMs * (1 + PROFILE.maxOverridePct),
      base.unfinishedThoughtWaitMs,
    );
  }
  const levels = { ...base.levels };
  let touched = false;
  if (facts.overconfident) {
    for (const key of ["L1", "L2", "L3", "L4"] as const) {
      levels[key] = clampToDefault(base.levels[key] * (1 - PROFILE.maxOverridePct), base.levels[key]);
    }
    touched = true;
  }
  if (facts.skipsOften) {
    levels.L1 = clampToDefault(levels.L1 * (1 + PROFILE.maxOverridePct), base.levels.L1);
    out.maxMovesPerConcept = Math.max(1, clampToDefault(base.maxMovesPerConcept * (1 - PROFILE.maxOverridePct), base.maxMovesPerConcept));
    touched = true;
  }
  if (touched) out.levels = levels;
  return out;
}

/** Apply only the adaptability knobs, each clamped to ±band of `base`. Missing keys stay at the default. */
export function applyProfileConfig(base: DuckConfig, overrides?: Partial<DuckConfig>): DuckConfig {
  if (!overrides) return base;
  const band = PROFILE.maxOverridePct;
  const next: DuckConfig = {
    ...base,
    levels: { ...base.levels },
    weights: { ...base.weights },
    recallFirstDays: { ...base.recallFirstDays },
  };
  if (typeof overrides.endOfTurnSilenceMs === "number") {
    next.endOfTurnSilenceMs = clampToDefault(overrides.endOfTurnSilenceMs, base.endOfTurnSilenceMs, band);
  }
  if (typeof overrides.unfinishedThoughtWaitMs === "number") {
    next.unfinishedThoughtWaitMs = clampToDefault(overrides.unfinishedThoughtWaitMs, base.unfinishedThoughtWaitMs, band);
  }
  if (typeof overrides.maxMovesPerConcept === "number") {
    next.maxMovesPerConcept = Math.max(1, clampToDefault(overrides.maxMovesPerConcept, base.maxMovesPerConcept, band));
  }
  if (typeof overrides.silenceRephraseMs === "number") {
    next.silenceRephraseMs = clampToDefault(overrides.silenceRephraseMs, base.silenceRephraseMs, band);
  }
  if (typeof overrides.silenceOfferSkipMs === "number") {
    next.silenceOfferSkipMs = clampToDefault(overrides.silenceOfferSkipMs, base.silenceOfferSkipMs, band);
  }
  if (overrides.levels) {
    for (const key of ["L1", "L2", "L3", "L4"] as const) {
      const value = overrides.levels[key];
      if (typeof value === "number") next.levels[key] = clampToDefault(value, base.levels[key], band);
    }
  }
  return next;
}

function quotedBits(line: string): string[] {
  const bits: string[] = [];
  const re = /"([^"]+)"|'([^']+)'|\u201c([^\u201d]+)\u201d/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line))) {
    bits.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return bits.filter(Boolean);
}

/** A profile line counts only if a quoted stretch appears verbatim in a student turn. */
export function lineHasStudentQuote(line: string, studentTexts: string[]): boolean {
  const quotes = quotedBits(line);
  if (quotes.length === 0) return false;
  return quotes.some((quote) => studentTexts.some((text) => findQuote(text, quote)));
}

export function keepQuotedLines(lines: string[], studentTexts: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+/g, " ").trim();
    if (!line || seen.has(line) || !lineHasStudentQuote(line, studentTexts)) continue;
    seen.add(line);
    out.push(line);
  }
  return out;
}

function firstQuote(turns: TurnLogRow[], test: (text: string) => boolean): string | undefined {
  for (const turn of turns) {
    const text = turn.text.replace(/\s+/g, " ").trim();
    if (text && test(text)) return text.length > 80 ? `${text.slice(0, 77)}...` : text;
  }
  return undefined;
}

function fallbackLearned(facts: ProfileFacts, turns: TurnLogRow[]): string[] {
  const student = turns.filter((t) => t.text.trim());
  const skip = firstQuote(student, (t) => /\bskip\b/i.test(t) || /\bmove on\b/i.test(t));
  const hedge = firstQuote(student, (t) => /\b(i think|maybe|kind of|or something)\b/i.test(t));
  const mid = firstQuote(student, (t) => MID_THOUGHT.test(t));
  const any = firstQuote(student, () => true);
  const lines: string[] = [];
  if (facts.skipsOften && skip) lines.push(`You skip when it gets sticky ("${skip}")`);
  if (facts.overconfident && any) lines.push(`You felt surer than what you owned ("${any}")`);
  if (facts.pausesMidThought && mid) lines.push(`You pause mid-thought ("${mid}")`);
  if (facts.hedgingTurns >= 2 && hedge) lines.push(`You hedge while you teach ("${hedge}")`);
  return lines;
}

function fallbackHabits(facts: ProfileFacts, lines: string[]): string[] {
  const habits: string[] = [];
  if (facts.skipsOften) habits.push("skips when pressed");
  if (facts.hedgingTurns >= 2) habits.push("hedges a lot");
  if (facts.pausesMidThought) habits.push("pauses mid-thought");
  if (lines.length === 0 && habits.length === 0) return [];
  return habits;
}

export function emptyProfile(userId: string, now = new Date()): Profile {
  return {
    userId,
    calibration: "",
    pace: "",
    nagginess: "",
    teachingHabits: [],
    tone: "",
    configOverrides: {},
    duckLearned: [],
    updatedAt: now.toISOString(),
  };
}

/** Merge AI prose (quote-checked) with code-owned overrides. */
export function finishProfile(input: {
  userId: string;
  turns: TurnLogRow[];
  previous?: Profile;
  facts: ProfileFacts;
  drafted?: Partial<Profile> | null;
  now?: Date;
  config?: DuckConfig;
}): Profile {
  const now = input.now ?? new Date();
  const config = input.config ?? DUCK;
  const studentTexts = input.turns.map((t) => t.text).filter((t) => t.trim());
  const drafted = input.drafted ?? {};
  const overrides = proposedOverrides(input.facts, config);
  const fresh = keepQuotedLines([...(drafted.duckLearned ?? []), ...fallbackLearned(input.facts, input.turns)], studentTexts);
  const kept = input.previous?.duckLearned ?? [];
  const learned = [...fresh];
  for (const line of kept) {
    if (!learned.includes(line)) learned.push(line);
  }
  learned.splice(6);

  const habits = (drafted.teachingHabits ?? []).filter((h) => lineHasStudentQuote(h, studentTexts));
  const fromCode = fallbackHabits(input.facts, learned);

  return {
    userId: input.userId,
    calibration: drafted.calibration?.trim() || (input.facts.overconfident ? "Often feels more sure than the owned share." : input.previous?.calibration || ""),
    pace: drafted.pace?.trim() || (input.facts.pausesMidThought ? "Pauses mid-thought; wait a beat longer." : input.previous?.pace || ""),
    nagginess: drafted.nagginess?.trim() || (input.facts.skipsOften ? "Skips when pressed; fewer follow-ups." : input.previous?.nagginess || ""),
    teachingHabits: habits.length > 0 ? habits : fromCode,
    tone: drafted.tone?.trim() || input.previous?.tone || "",
    configOverrides: overrides,
    duckLearned: learned,
    updatedAt: now.toISOString(),
  };
}

export function toTurnLogRows(
  rows: {
    id: string;
    sessionId: string;
    n: number;
    text: string;
    startedAt: string | Date | null;
    endedAt: string | Date | null;
    signals: string[];
    scoreAfter: number | null;
    level: TurnLogRow["level"];
    moveKind: MoveKind | null;
    line: string;
  }[],
): TurnLogRow[] {
  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    n: r.n,
    text: r.text,
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : (r.startedAt ?? ""),
    endedAt: r.endedAt instanceof Date ? r.endedAt.toISOString() : (r.endedAt ?? ""),
    signals: r.signals,
    scoreAfter: r.scoreAfter ?? 0,
    level: r.level,
    moveKind: (r.moveKind ?? "open") as TurnLogRow["moveKind"],
    line: r.line,
  }));
}

export function sessionConfig(overrides?: Partial<DuckConfig>): DuckConfig {
  return applyProfileConfig(DUCK, overrides);
}
