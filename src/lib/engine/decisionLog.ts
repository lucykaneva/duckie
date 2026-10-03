// B14: map stored turn rows into the decision log the debrief reads.
// The log never carries a stored answer or reference code.

import type { DecisionLogRow, DecisionSource, Level, MoveKind, SessionLog } from "../duck/types";

const SOURCES: DecisionSource[] = ["student", "silence", "steer"];

function iso(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  return value ?? "";
}

function asSource(value: unknown): DecisionSource {
  return SOURCES.includes(value as DecisionSource) ? (value as DecisionSource) : "student";
}

function asSignals(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function asMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (raw.judge !== undefined) out.judge = raw.judge;
  if (raw.judgeMs !== undefined) out.judgeMs = raw.judgeMs;
  if (raw.answer !== undefined) out.answer = raw.answer;
  if (Array.isArray(raw.words)) out.words = raw.words;
  if (Array.isArray(raw.leakBlocked)) out.leakBlocked = raw.leakBlocked;
  return out;
}

export interface DecisionLogInputRow {
  id: string;
  sessionId: string;
  n: number;
  source?: unknown;
  text: string;
  startedAt?: string | Date | null;
  endedAt?: string | Date | null;
  signals?: unknown;
  scoreAfter?: number | null;
  level?: Level | null;
  moveKind?: MoveKind | null;
  line?: string | null;
  conceptId?: string | null;
  conceptName?: string | null;
  meta?: unknown;
}

export function toDecisionLogRows(rows: DecisionLogInputRow[]): DecisionLogRow[] {
  return [...rows]
    .sort((a, b) => a.n - b.n)
    .map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      n: r.n,
      source: asSource(r.source),
      text: r.text,
      startedAt: iso(r.startedAt),
      endedAt: iso(r.endedAt),
      signals: asSignals(r.signals),
      scoreAfter: r.scoreAfter ?? null,
      level: r.level ?? null,
      moveKind: r.moveKind ?? null,
      line: r.line ?? "",
      conceptId: r.conceptId ?? null,
      conceptName: r.conceptName ?? null,
      meta: asMeta(r.meta),
    }));
}

export function sessionLog(sessionId: string, topic: string, rows: DecisionLogInputRow[]): SessionLog {
  return { sessionId, topic, turns: toDecisionLogRows(rows) };
}
