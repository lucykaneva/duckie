import type { DuckMove } from "../duck/types";
import { findLeak } from "./answers";
import type { ConceptDef } from "./turn";
import { LEAK_FALLBACK_LINE } from "./wording";

// The leak check (spec: "Code checks every duck line for the stored answer value before it is spoken").
// Runs on every line the engine is about to send, whoever wrote it. Until the student has committed
// to an answer for a trace or prediction concept, no line may say that concept's answer.

export interface StoredAnswer {
  conceptId: string;
  expectedAnswer: string;
}

export interface GuardResult {
  move: DuckMove;
  /** Concept ids whose answer a line was about to say. For logs only; never the answer itself. */
  blocked: string[];
}

/**
 * Replace any line that says an uncommitted concept's answer. The replacement is the concept's
 * precomputed line for the same level when that is safe, otherwise a neutral "walk me through it".
 */
export function guardMove(
  move: DuckMove,
  defs: ConceptDef[],
  answers: StoredAnswer[],
  committed: string[],
): GuardResult {
  const live = answers.filter((a) => !committed.includes(a.conceptId));
  if (live.length === 0) return { move, blocked: [] };

  const defById = new Map(defs.map((d) => [d.id, d]));
  const secrets = live.map((a) => ({
    conceptId: a.conceptId,
    expectedAnswer: a.expectedAnswer,
    givenText: defById.get(a.conceptId)?.checkPrompt ?? undefined,
  }));
  const blocked: string[] = [];

  const guardLine = (line: string, conceptId: string, level: DuckMove["level"]): string => {
    const hit = secrets.find((s) => findLeak(line, [s]) !== null);
    if (!hit) return line;
    blocked.push(hit.conceptId);
    const precomputed = level === "L0" ? undefined : defById.get(conceptId)?.fallbackQuestions[level];
    return precomputed && findLeak(precomputed, secrets) === null ? precomputed : LEAK_FALLBACK_LINE;
  };

  const guarded = (m: DuckMove): DuckMove => {
    const next: DuckMove = { ...m, line: guardLine(m.line, m.conceptId, m.level) };
    if (m.then) next.then = guarded(m.then);
    return next;
  };
  return { move: guarded(move), blocked };
}
