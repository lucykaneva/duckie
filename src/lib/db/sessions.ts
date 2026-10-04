import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  DuckMove,
  DueRecall,
  Level,
  MoveKind,
  Profile,
  SessionLog,
  SessionResults,
  TurnLogRow,
} from "../duck/types";
import { sessionLog } from "../engine/decisionLog";
import { DEMO_USER_ID } from "../duck/types";
import { buildDebrief, understandingPercent } from "../engine/debrief";
import type { ExistingRecall } from "../engine/debrief";
import type { StoredAnswer } from "../engine/guard";
import { orchestrateSilence, orchestrateTurn } from "../engine/orchestrate";
import type { OrchestrateDeps, TurnMeta } from "../engine/orchestrate";
import {
  finishProfile,
  profileFacts,
  sessionConfig,
  toTurnLogRows,
} from "../engine/profile";
import { silenceStepFor } from "../engine/silence";
import { freshSession, openingMove } from "../engine/turn";
import type { ConceptDef, ConceptRun, SessionRun } from "../engine/turn";
import { judgeTurn } from "../prompts/judgeTurn";
import { summarizeProfile } from "../prompts/summarizeProfile";
import { wordMoveDetailed } from "../prompts/wordMove";
import { getPool } from "./client";
import { getLearnerProfile, saveLearnerProfile } from "./profile";

/** The real Grok calls. Tests pass fakes. */
export const liveDeps: OrchestrateDeps = { judge: judgeTurn, word: wordMoveDetailed, summarize: summarizeProfile };

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
    const owner = await client.query<{ user_id: string }>(
      `SELECT c.user_id FROM sections sec JOIN courses c ON c.id = sec.course_id WHERE sec.id = $1`,
      [input.sectionId],
    );
    const userId = owner.rows[0]?.user_id ?? DEMO_USER_ID;
    const profile = await getLearnerProfile(userId, client);
    const fresh: SessionRun = {
      ...freshSession(defs),
      configOverrides: profile.configOverrides,
      toneHint: profile.tone || undefined,
    };
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
  topic: string;
  confidence: number;
  userId: string;
  ended: boolean;
}

type Locked =
  | { status: "ok"; session: LoadedSession }
  | { status: "not_found" }
  | { status: "ended" };

/** Lock the session row and load everything the engine needs. The caller owns the transaction. */
async function lockAndLoad(
  client: PoolClient,
  sessionId: string,
  opts: { allowEnded?: boolean; forUpdate?: boolean } = {},
): Promise<Locked> {
  const lock = opts.forUpdate === false ? "" : " FOR UPDATE";
  const row = await client.query<{
    section_id: string;
    topic: string;
    confidence: number | null;
    started_at: Date;
    ended_at: Date | null;
    engine: StoredEngine | null;
  }>(`SELECT section_id, topic, confidence, started_at, ended_at, engine FROM sessions WHERE id = $1${lock}`, [
    sessionId,
  ]);
  if (row.rowCount === 0) return { status: "not_found" };
  if (row.rows[0].ended_at && !opts.allowEnded) return { status: "ended" };

  const owner = await client.query<{ user_id: string }>(
    `SELECT c.user_id FROM sections sec JOIN courses c ON c.id = sec.course_id WHERE sec.id = $1`,
    [row.rows[0].section_id],
  );

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

  return {
    status: "ok",
    session: {
      sectionId,
      defs,
      run,
      nextN: (last.rows[0]?.n ?? 0) + 1,
      topic: row.rows[0].topic,
      confidence: row.rows[0].confidence ?? 3,
      userId: owner.rows[0]?.user_id ?? DEMO_USER_ID,
      ended: row.rows[0].ended_at !== null,
    },
  };
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
  meta?: TurnMeta;
}

/** One row of the decision log. signals and score_after describe what the student's words were judged against. */
async function logRow(client: PoolClient, sessionId: string, row: LogRow): Promise<void> {
  await client.query(
    `INSERT INTO turns
       (id, session_id, n, text, started_at, ended_at, signals, score_after, level, move_kind, line, concept_id, source, meta)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13, $14::jsonb)`,
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
      JSON.stringify(row.meta ?? {}),
    ],
  );
}

/** The last few things said, oldest first, so Grok can check this turn against the question that started it. */
async function recentDialogue(client: PoolClient, sessionId: string): Promise<string> {
  const found = await client.query<{ source: string; text: string; line: string }>(
    `SELECT source, text, line FROM turns WHERE session_id = $1 ORDER BY n DESC LIMIT 6`,
    [sessionId],
  );
  const clip = (value: string) => {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length <= 240 ? flat : flat.slice(0, 240);
  };
  const lines: string[] = [];
  for (const row of found.rows.reverse()) {
    if (row.text.trim()) lines.push(`Student: ${clip(row.text)}`);
    if (row.line.trim()) lines.push(`Duck: ${clip(row.line)}`);
  }
  return lines.join("\n");
}

/**
 * Evaluate one finished student turn and save everything it changed: the concept
 * states, the engine state and the log rows (the turn, plus the follow-up after a celebration).
 *
 * The Grok calls (judge, then wording) happen while the session row is locked, so a silence timer that
 * fires meanwhile waits for this turn instead of acting on state that is about to change. Both calls
 * have time limits, so the lock is held for a few seconds at most.
 */
export async function runTurn(
  sessionId: string,
  turn: { text: string; startedAt: Date | null; endedAt: Date | null },
  deps: OrchestrateDeps = liveDeps,
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

    const answers = await loadAnswers(client, locked.session.sectionId);
    const conversation = await recentDialogue(client, sessionId);
    const config = sessionConfig(run.configOverrides);
    const { outcome, meta } = await orchestrateTurn(
      {
        defs,
        run,
        answers,
        text: turn.text,
        conversation,
        nowMs: (turn.endedAt ?? new Date()).getTime(),
        toneHint: run.toneHint,
      },
      deps,
      config,
    );
    if (meta.leakBlocked.length > 0) console.warn(`leak check blocked a line about ${meta.leakBlocked.join(", ")}`);
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
      meta,
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
export async function runSilence(
  sessionId: string,
  ms: number,
  deps: OrchestrateDeps = liveDeps,
): Promise<SilenceResult> {
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
    const { defs, run, nextN } = locked.session;

    const answers = await loadAnswers(client, locked.session.sectionId);
    const config = sessionConfig(run.configOverrides);
    const outcome = await orchestrateSilence(
      { defs, run, answers, step, nowMs: Date.now(), toneHint: run.toneHint },
      deps,
      config,
    );
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
      meta: outcome.meta,
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

function wrapMove(run: SessionRun, defs: ConceptDef[], line: string): DuckMove {
  return {
    kind: "wrap_up",
    level: "L0",
    conceptId: run.focusConceptId ?? defs[0]?.id ?? "",
    line,
    sessionState: "wrapping_up",
    concepts: run.concepts.map((c) => ({ id: c.conceptId, state: c.state, score: c.score })),
  };
}

async function debriefBits(
  client: PoolClient,
  sessionId: string,
  userId: string,
  conceptIds: string[],
): Promise<{
  quotes: { conceptId: string; text: string }[];
  celebrationLine: string | null;
  existingRecall: ExistingRecall[];
}> {
  const quotes = await client.query<{ concept_id: string; text: string }>(
    `SELECT concept_id, text FROM turns
      WHERE session_id = $1 AND source = 'student' AND text <> '' AND concept_id IS NOT NULL
      ORDER BY n`,
    [sessionId],
  );
  const cele = await client.query<{ line: string }>(
    `SELECT line FROM turns WHERE session_id = $1 AND move_kind = 'celebrate' AND line <> '' ORDER BY n LIMIT 1`,
    [sessionId],
  );
  const recall = await client.query<{
    concept_id: string;
    state_after: ExistingRecall["stateAfter"];
    interval_days: number;
    successes: number;
    due: string;
  }>(
    `SELECT concept_id, state_after, interval_days, successes, due_date::text AS due
       FROM recall WHERE user_id = $1 AND concept_id = ANY($2::text[])`,
    [userId, conceptIds],
  );
  return {
    quotes: quotes.rows.map((r) => ({ conceptId: r.concept_id, text: r.text })),
    celebrationLine: cele.rows[0]?.line ?? null,
    existingRecall: recall.rows.map((r) => ({
      conceptId: r.concept_id,
      stateAfter: r.state_after,
      intervalDays: r.interval_days,
      successes: r.successes,
      due: r.due,
    })),
  };
}

async function loadTurnLog(client: PoolClient, sessionId: string): Promise<TurnLogRow[]> {
  const { rows } = await client.query<{
    id: string;
    session_id: string;
    n: number;
    text: string;
    started_at: Date | null;
    ended_at: Date | null;
    signals: unknown;
    score_after: number | null;
    level: Level | null;
    move_kind: MoveKind | null;
    line: string;
  }>(
    `SELECT id, session_id, n, text, started_at, ended_at, signals, score_after, level, move_kind, line
       FROM turns WHERE session_id = $1 AND source = 'student' AND text <> '' ORDER BY n`,
    [sessionId],
  );
  return toTurnLogRows(
    rows.map((r) => ({
      id: r.id,
      sessionId: r.session_id,
      n: r.n,
      text: r.text,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      signals: Array.isArray(r.signals) ? (r.signals as string[]) : [],
      scoreAfter: r.score_after,
      level: r.level,
      moveKind: r.move_kind,
      line: r.line,
    })),
  );
}

async function refreshLearnerProfile(
  client: PoolClient,
  sessionId: string,
  userId: string,
  concepts: ConceptRun[],
  confidence: number,
  deps: OrchestrateDeps,
): Promise<Profile> {
  const turns = await loadTurnLog(client, sessionId);
  const previous = await getLearnerProfile(userId, client);
  const sessions = [{ confidence, understanding: understandingPercent(concepts) }];
  let profile: Profile | null = null;
  if (deps.summarize) {
    try {
      profile = await deps.summarize({ turns, previous, sessions, userId });
    } catch {
      // Grok path already falls back inside A11; this is only if the function itself throws.
    }
  }
  if (!profile) {
    profile = finishProfile({
      userId,
      turns,
      previous,
      facts: profileFacts({ concepts, turns, confidence }),
    });
  }
  await saveLearnerProfile(profile, client);
  return profile;
}

export type EndResult = { status: "ok"; move: DuckMove } | { status: "not_found" };

/** Close the session: scores, recall dates, and the spoken wrap-up. Safe to call twice. */
export async function endSession(
  sessionId: string,
  reason: string,
  deps: OrchestrateDeps = liveDeps,
): Promise<EndResult> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await lockAndLoad(client, sessionId, { allowEnded: true });
    if (locked.status !== "ok") {
      await client.query("ROLLBACK");
      return { status: "not_found" };
    }
    const { defs, run, topic, confidence, userId, ended } = locked.session;
    if (ended && run.closingLine) {
      await client.query("COMMIT");
      return { status: "ok", move: wrapMove(run, defs, run.closingLine) };
    }

    const bits = await debriefBits(
      client,
      sessionId,
      userId,
      run.concepts.map((c) => c.conceptId),
    );
    const { results, recall, wrapLine, situation } = buildDebrief({
      sessionId,
      topic,
      confidence,
      defs,
      concepts: run.concepts,
      quotes: bits.quotes,
      celebrationLine: bits.celebrationLine,
      existingRecall: bits.existingRecall,
    });

    const worded = await deps.word({
      kind: "wrap_up",
      level: "L0",
      conceptName: results.reviseNext,
      topic,
      studentWords: bits.quotes.map((q) => q.text).join(" "),
      fallbackLine: wrapLine,
      situation,
      toneHint: run.toneHint,
    });
    const line = worded.line;

    for (const row of recall) {
      await client.query(
        `INSERT INTO recall (user_id, concept_id, state_after, interval_days, due_date, successes)
         VALUES ($1, $2, $3, $4, $5::date, $6)
         ON CONFLICT (user_id, concept_id) DO UPDATE SET
           state_after = EXCLUDED.state_after,
           interval_days = EXCLUDED.interval_days,
           due_date = EXCLUDED.due_date,
           successes = EXCLUDED.successes`,
        [userId, row.conceptId, row.stateAfter, row.intervalDays, row.due, row.successes],
      );
    }

    const closed: SessionRun = { ...run, closing: true, closingLine: line };
    await saveRun(client, sessionId, closed);
    await client.query(`UPDATE sessions SET ended_at = now(), end_reason = $2 WHERE id = $1`, [sessionId, reason]);
    await refreshLearnerProfile(client, sessionId, userId, run.concepts, confidence, deps);
    await client.query("COMMIT");
    return { status: "ok", move: wrapMove(closed, defs, line) };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Debrief for the results page. Works before or after /end. */
export async function getSessionResults(sessionId: string): Promise<SessionResults | null> {
  const client = await getPool().connect();
  try {
    const locked = await lockAndLoad(client, sessionId, { allowEnded: true, forUpdate: false });
    if (locked.status !== "ok") {
      return null;
    }
    const { defs, run, topic, confidence, userId, ended } = locked.session;
    const bits = await debriefBits(
      client,
      sessionId,
      userId,
      run.concepts.map((c) => c.conceptId),
    );
    const profile = await getLearnerProfile(userId, client);
    const { results } = buildDebrief({
      sessionId,
      topic,
      confidence,
      defs,
      concepts: run.concepts,
      quotes: bits.quotes,
      celebrationLine: bits.celebrationLine,
      existingRecall: bits.existingRecall,
      freezeRecall: ended,
      duckLearned: profile.duckLearned,
    });
    return results;
  } finally {
    client.release();
  }
}

/** Every logged row for a session, in order. Null if the session does not exist. */
export async function getSessionLog(sessionId: string): Promise<SessionLog | null> {
  const client = await getPool().connect();
  try {
    const session = await client.query<{ topic: string }>(`SELECT topic FROM sessions WHERE id = $1`, [sessionId]);
    if (session.rowCount === 0) return null;
    const { rows } = await client.query<{
      id: string;
      session_id: string;
      n: number;
      source: string;
      text: string;
      started_at: Date | null;
      ended_at: Date | null;
      signals: unknown;
      score_after: number | null;
      level: Level | null;
      move_kind: MoveKind | null;
      line: string | null;
      concept_id: string | null;
      concept_name: string | null;
      meta: unknown;
    }>(
      `SELECT t.id, t.session_id, t.n, t.source, t.text, t.started_at, t.ended_at, t.signals,
              t.score_after, t.level, t.move_kind, t.line, t.concept_id, c.name AS concept_name, t.meta
         FROM turns t
         LEFT JOIN concepts c ON c.id = t.concept_id
        WHERE t.session_id = $1
        ORDER BY t.n`,
      [sessionId],
    );
    return sessionLog(
      sessionId,
      session.rows[0].topic,
      rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        n: r.n,
        source: r.source,
        text: r.text,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        signals: r.signals,
        scoreAfter: r.score_after,
        level: r.level,
        moveKind: r.move_kind,
        line: r.line,
        conceptId: r.concept_id,
        conceptName: r.concept_name,
        meta: r.meta,
      })),
    );
  } finally {
    client.release();
  }
}

/** Concepts due today or earlier for the demo user (the API contract's one hardcoded user). */
export async function listDueRecall(userId = DEMO_USER_ID, today = new Date()): Promise<DueRecall[]> {
  const { rows } = await getPool().query<{
    concept_id: string;
    name: string;
    topic: string;
    due: string;
    state_after: DueRecall["stateAfter"];
  }>(
    `SELECT r.concept_id, c.name, c.topic, r.due_date::text AS due, r.state_after
       FROM recall r
       JOIN concepts c ON c.id = r.concept_id
      WHERE r.user_id = $1 AND r.due_date <= $2::date
      ORDER BY r.due_date, c.slide, c.id`,
    [userId, today.toISOString().slice(0, 10)],
  );
  return rows.map((r) => ({
    conceptId: r.concept_id,
    name: r.name,
    topic: r.topic,
    due: r.due,
    stateAfter: r.state_after,
  }));
}
