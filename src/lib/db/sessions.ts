import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DuckMove, JudgeResult, Level, MoveKind } from "../duck/types";
import { processTurn, freshSession, openingMove } from "../engine/turn";
import type { ConceptDef, ConceptRun, SessionRun } from "../engine/turn";
import { getPool } from "./client";

// Loads a session's state, runs the engine on one finished turn, and saves the result.

interface ConceptRow {
  id: string;
  topic: string;
  name: string;
  slide: number | null;
  kind: ConceptDef["kind"];
  misconceptions: string[];
  check_prompt: string | null;
  fallback_questions: ConceptDef["fallbackQuestions"] | null;
}

/** Scores are stored as REAL; round away float noise so thresholds compare exactly. */
const cleanScore = (value: number): number => Math.round(value * 1e6) / 1e6;

async function loadDefs(client: PoolClient, sectionId: string): Promise<ConceptDef[]> {
  const { rows } = await client.query<ConceptRow>(
    `SELECT id, topic, name, slide, kind, misconceptions, check_prompt, fallback_questions
       FROM concepts
      WHERE section_id = $1
      ORDER BY slide, id`,
    [sectionId],
  );
  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    name: r.name,
    slide: r.slide ?? 0,
    kind: r.kind,
    misconceptions: r.misconceptions ?? [],
    checkPrompt: r.check_prompt,
    fallbackQuestions: r.fallback_questions ?? {},
  }));
}

export interface CreatedSession {
  sessionId: string;
  sectionId: string;
  topic: string;
  confidence: number;
  move: DuckMove;
}

/** Start a session on a section. Returns null if the section has no concepts. */
export async function createSession(input: {
  sectionId: string;
  topic: string;
  confidence: number;
}): Promise<CreatedSession | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const defs = await loadDefs(client, input.sectionId);
    if (defs.length === 0) {
      await client.query("ROLLBACK");
      return null;
    }

    const sessionId = `s_${randomUUID().slice(0, 8)}`;
    await client.query(
      `INSERT INTO sessions (id, section_id, topic, confidence) VALUES ($1, $2, $3, $4)`,
      [sessionId, input.sectionId, input.topic, input.confidence],
    );
    for (const c of freshSession(defs).concepts) {
      await client.query(
        `INSERT INTO concept_state (session_id, concept_id, state, score, level_reached)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, c.conceptId, c.state, c.score, c.levelReached],
      );
    }
    await client.query("COMMIT");
    return { sessionId, ...input, move: openingMove(defs) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type TurnResult =
  | { status: "ok"; move: DuckMove }
  | { status: "not_found" }
  | { status: "ended" };

interface ConceptStateRow {
  concept_id: string;
  state: ConceptRun["state"];
  score: number;
  level_reached: Level | null;
  moves: number;
  failed_attempts: number;
  skipped: boolean;
  celebrated: boolean;
}

/**
 * Evaluate one finished student turn and save everything it changed: the concept
 * states and one `turns` row. The session row is locked so two turns cannot interleave.
 */
export async function runTurn(
  sessionId: string,
  turn: { text: string; startedAt: Date | null; endedAt: Date | null },
  judge: JudgeResult,
): Promise<TurnResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const session = await client.query<{ section_id: string; ended_at: Date | null }>(
      `SELECT section_id, ended_at FROM sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    if (session.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: "not_found" };
    }
    if (session.rows[0].ended_at) {
      await client.query("ROLLBACK");
      return { status: "ended" };
    }

    const defs = await loadDefs(client, session.rows[0].section_id);
    const states = await client.query<ConceptStateRow>(
      `SELECT concept_id, state, score, level_reached, moves, failed_attempts, skipped, celebrated
         FROM concept_state WHERE session_id = $1`,
      [sessionId],
    );
    const byId = new Map(states.rows.map((r) => [r.concept_id, r]));
    const last = await client.query<{ n: number; move_kind: MoveKind | null; concept_id: string | null }>(
      `SELECT n, move_kind, concept_id FROM turns WHERE session_id = $1 ORDER BY n DESC LIMIT 1`,
      [sessionId],
    );

    const run: SessionRun = {
      concepts: defs.map((d) => {
        const r = byId.get(d.id);
        return {
          conceptId: d.id,
          state: r?.state ?? "not_yet",
          score: cleanScore(r?.score ?? 0),
          levelReached: r?.level_reached ?? "L0",
          moves: r?.moves ?? 0,
          failedAttempts: r?.failed_attempts ?? 0,
          skipped: r?.skipped ?? false,
          celebrated: r?.celebrated ?? false,
        };
      }),
      focusConceptId: last.rows[0]?.concept_id ?? null,
      lastMoveKind: last.rows[0]?.move_kind ?? null,
      turnCount: last.rows[0]?.n ?? 0,
    };

    const outcome = processTurn(defs, run, { text: turn.text, judge });

    for (const c of outcome.session.concepts) {
      await client.query(
        `INSERT INTO concept_state
           (session_id, concept_id, state, score, level_reached, moves, failed_attempts, skipped, celebrated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (session_id, concept_id) DO UPDATE SET
           state = EXCLUDED.state, score = EXCLUDED.score, level_reached = EXCLUDED.level_reached,
           moves = EXCLUDED.moves, failed_attempts = EXCLUDED.failed_attempts,
           skipped = EXCLUDED.skipped, celebrated = EXCLUDED.celebrated`,
        [
          sessionId,
          c.conceptId,
          c.state,
          c.score,
          c.levelReached,
          c.moves,
          c.failedAttempts,
          c.skipped,
          c.celebrated,
        ],
      );
    }

    // The decision log. signals and score_after describe the concept the student's
    // words were judged against; concept_id and level describe the duck's reply.
    const n = outcome.session.turnCount;
    await client.query(
      `INSERT INTO turns
         (id, session_id, n, text, started_at, ended_at, signals, score_after, level, move_kind, line, concept_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12)`,
      [
        `t_${sessionId}_${n}`,
        sessionId,
        n,
        turn.text,
        turn.startedAt,
        turn.endedAt,
        JSON.stringify(outcome.signals),
        outcome.scoreAfter,
        outcome.move.level,
        outcome.move.kind,
        outcome.move.line,
        outcome.move.conceptId || null,
      ],
    );

    await client.query("COMMIT");
    return { status: "ok", move: outcome.move };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
