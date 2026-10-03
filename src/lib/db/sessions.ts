import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { DuckMove, JudgeResult, Level, MoveKind } from "../duck/types";
import { committedAnswer } from "../engine/commit";
import { guardMove } from "../engine/guard";
import type { StoredAnswer } from "../engine/guard";
import { processSilence, silenceStepFor } from "../engine/silence";
import { processTurn, freshSession, openingMove } from "../engine/turn";
import type { ConceptDef, ConceptRun, SessionRun } from "../engine/turn";
import { getPool } from "./client";

// Loads a session's state, runs the engine on one event (a finished student turn or a
// silence timer), and saves the result. The session row is locked for the whole event
// so two events cannot interleave.

interface ConceptRow {
  id: string;
  topic: string;
  name: string;
  slide: number | null;
  kind: ConceptDef["kind"];
  misconceptions: string[];
  check_prompt: string | null;
  plants_misconception: boolean;
  fallback_questions: ConceptDef["fallbackQuestions"] | null;
}

/** Scores are stored as REAL; round away float noise so thresholds compare exactly. */
const cleanScore = (value: number): number => Math.round(value * 1e6) / 1e6;

async function loadDefs(client: PoolClient, sectionId: string): Promise<ConceptDef[]> {
  const { rows } = await client.query<ConceptRow>(
    `SELECT id, topic, name, slide, kind, misconceptions, check_prompt, plants_misconception, fallback_questions
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
    plantsMisconception: r.plants_misconception,
    fallbackQuestions: r.fallback_questions ?? {},
  }));
}

/** The part of SessionRun that lives in `sessions.engine`. Concept states have their own table. */
type StoredEngine = Omit<SessionRun, "concepts" | "startedAtMs">;

function toStored(run: SessionRun): StoredEngine {
  const stored: Partial<SessionRun> = { ...run };
  delete stored.concepts;
  delete stored.startedAtMs;
  return stored as StoredEngine;
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
    const fresh = freshSession(defs);
    await client.query(
      `INSERT INTO sessions (id, section_id, topic, confidence, engine) VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [sessionId, input.sectionId, input.topic, input.confidence, JSON.stringify(toStored(fresh))],
    );
    for (const c of fresh.concepts) {
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

export type SilenceResult =
  | { status: "ok"; move: DuckMove }
  | { status: "not_found" }
  | { status: "ended" }
  /** The timer fired for a silence shorter than the first brake. */
  | { status: "too_short" }
  /** Nothing to do: the student spoke, the step was already handled, or the session is paused or closing. */
  | { status: "stale" };

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

interface LoadedSession {
  sectionId: string;
  defs: ConceptDef[];
  run: SessionRun;
  /** Next number for the `turns` log. */
  nextN: number;
}

type Locked =
  | { status: "ok"; session: LoadedSession }
  | { status: "not_found" }
  | { status: "ended" };

/** Lock the session row and load everything the engine needs. The caller owns the transaction. */
async function lockAndLoad(client: PoolClient, sessionId: string): Promise<Locked> {
  const row = await client.query<{
    section_id: string;
    started_at: Date;
    ended_at: Date | null;
    engine: StoredEngine | null;
  }>(`SELECT section_id, started_at, ended_at, engine FROM sessions WHERE id = $1 FOR UPDATE`, [
    sessionId,
  ]);
  if (row.rowCount === 0) return { status: "not_found" };
  if (row.rows[0].ended_at) return { status: "ended" };

  const sectionId = row.rows[0].section_id;
  const defs = await loadDefs(client, sectionId);
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

  const base = freshSession(defs, row.rows[0].started_at.getTime());
  const stored = row.rows[0].engine;
  const run: SessionRun = {
    ...base,
    // Sessions created before B9 have no stored engine state: rebuild what B7 kept in the turn log.
    ...(stored ?? {
      focusConceptId: last.rows[0]?.concept_id ?? null,
      lastMoveKind: last.rows[0]?.move_kind ?? null,
      turnCount: last.rows[0]?.n ?? 0,
    }),
    startedAtMs: row.rows[0].started_at.getTime(),
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
  };

  return { status: "ok", session: { sectionId, defs, run, nextN: (last.rows[0]?.n ?? 0) + 1 } };
}

/**
 * The stored answers of this section's trace and prediction concepts. Server only: these go to
 * the comparison and the leak check, never into an API response or an AI prompt.
 */
async function loadAnswers(client: PoolClient, sectionId: string): Promise<StoredAnswer[]> {
  const { rows } = await client.query<{ concept_id: string; expected_answer: string }>(
    `SELECT s.concept_id, s.expected_answer
       FROM concept_secrets s JOIN concepts c ON c.id = s.concept_id
      WHERE c.section_id = $1 AND s.expected_answer IS NOT NULL`,
    [sectionId],
  );
  return rows.map((r) => ({ conceptId: r.concept_id, expectedAnswer: r.expected_answer }));
}

async function saveRun(client: PoolClient, sessionId: string, run: SessionRun): Promise<void> {
  for (const c of run.concepts) {
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
  await client.query(`UPDATE sessions SET engine = $2::jsonb WHERE id = $1`, [
    sessionId,
    JSON.stringify(toStored(run)),
  ]);
}

interface LogRow {
  n: number;
  source: "student" | "silence" | "steer";
  text: string;
  startedAt?: Date | null;
  endedAt?: Date | null;
  signals: string[];
  scoreAfter: number | null;
  move: Pick<DuckMove, "level" | "kind" | "line" | "conceptId">;
}

/** One row of the decision log. signals and score_after describe what the student's words were judged against. */
async function logRow(client: PoolClient, sessionId: string, row: LogRow): Promise<void> {
  await client.query(
    `INSERT INTO turns
       (id, session_id, n, text, started_at, ended_at, signals, score_after, level, move_kind, line, concept_id, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)`,
    [
      `t_${sessionId}_${row.n}`,
      sessionId,
      row.n,
      row.text,
      row.startedAt ?? null,
      row.endedAt ?? null,
      JSON.stringify(row.signals),
      row.scoreAfter,
      row.move.level,
      row.move.kind,
      row.move.line,
      row.move.conceptId || null,
      row.source,
    ],
  );
}

/**
 * Evaluate one finished student turn and save everything it changed: the concept
 * states, the engine state and the log rows (the turn, plus the follow-up after a celebration).
 */
export async function runTurn(
  sessionId: string,
  turn: { text: string; startedAt: Date | null; endedAt: Date | null },
  judge: JudgeResult,
): Promise<TurnResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await lockAndLoad(client, sessionId);
    if (locked.status !== "ok") {
      await client.query("ROLLBACK");
      return locked;
    }
    const { defs, run, nextN } = locked.session;

    const nowMs = (turn.endedAt ?? new Date()).getTime();
    const answers = await loadAnswers(client, locked.session.sectionId);
    const answer = committedAnswer(turn.text, run, defs, answers);
    const raw = processTurn(defs, run, { text: turn.text, judge, answer, nowMs });

    // Leak check: no line may say a stored answer before the student has committed to one.
    const guard = guardMove(raw.move, defs, answers, raw.session.committed);
    if (guard.blocked.length > 0) console.warn(`leak check blocked a line about ${guard.blocked.join(", ")}`);
    const spoken = guard.move.then ?? guard.move;
    const outcome = { ...raw, move: guard.move, session: { ...raw.session, lastLine: spoken.line } };
    await saveRun(client, sessionId, outcome.session);

    await logRow(client, sessionId, {
      n: nextN,
      source: "student",
      text: turn.text,
      startedAt: turn.startedAt,
      endedAt: turn.endedAt,
      signals: outcome.signals,
      scoreAfter: outcome.scoreAfter,
      move: outcome.move,
    });
    if (outcome.move.then) {
      await logRow(client, sessionId, {
        n: nextN + 1,
        source: "steer",
        text: "",
        signals: [],
        scoreAfter: null,
        move: outcome.move.then,
      });
    }

    await client.query("COMMIT");
    return { status: "ok", move: outcome.move };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Handle a silence timer (8, 20 or 45 s after the duck's last line). */
export async function runSilence(sessionId: string, ms: number): Promise<SilenceResult> {
  const step = silenceStepFor(ms);
  if (step === null) return { status: "too_short" };

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await lockAndLoad(client, sessionId);
    if (locked.status !== "ok") {
      await client.query("ROLLBACK");
      return locked;
    }
    const { run, nextN } = locked.session;

    const outcome = processSilence(run, step, Date.now());
    if (!outcome) {
      await client.query("ROLLBACK");
      return { status: "stale" };
    }
    await saveRun(client, sessionId, outcome.session);
    await logRow(client, sessionId, {
      n: nextN,
      source: "silence",
      text: "",
      signals: outcome.signals,
      scoreAfter: outcome.scoreAfter,
      move: outcome.move,
    });

    await client.query("COMMIT");
    return { status: "ok", move: outcome.move };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
