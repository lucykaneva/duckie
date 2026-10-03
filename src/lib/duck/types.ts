import type { DuckConfig } from "./config";

export type ConceptState =
  | "not_yet"
  | "owned"
  | "assisted"
  | "explained_to"
  | "misconception"
  | "skipped";

export type Level = "L0" | "L1" | "L2" | "L3" | "L4";

export type MoveKind =
  | "open"
  | "confidence"
  | "question"
  | "rephrase"
  | "ack"
  | "celebrate"
  /** After a correct answer: confirm it, add one small hint, and ask the student to say it back. */
  | "reinforce"
  | "offer_skip"
  | "check_in"
  | "pause"
  | "wrap_up";

export type ConceptKind = "explain" | "trace" | "predict";
export type SectionType = "test" | "project";
export type SessionState = "active" | "paused" | "wrapping_up";

export const DEMO_USER_ID = "u_demo";

/** What the client sees. Never includes reference_code or expected_answer. */
export interface Concept {
  id: string;
  topic: string;
  name: string;
  slide: number;
  kind: ConceptKind;
  misconceptions: string[];
}

export interface ConceptForJudge {
  id: string;
  name: string;
  misconceptions: string[];
}

export interface ConceptProgress {
  id: string;
  state: ConceptState;
  score: number;
}

export interface DuckMove {
  kind: MoveKind;
  level: Level;
  conceptId: string;
  line: string;
  sessionState: SessionState;
  concepts: ConceptProgress[];
  /**
   * A follow-up move the duck makes on its own after this one (B9). Only set on a
   * `celebrate` move: speak `line`, wait for the audio to end plus DUCK.afterCelebrationMs,
   * then speak `then.line`. The server has already counted `then` as asked.
   */
  then?: DuckMove;
}

export interface SessionStart {
  sessionId: string;
  topic: string;
  confidence: number;
  move: DuckMove;
}

export interface ResultsConcept {
  id: string;
  name: string;
  state: ConceptState;
  levelReached: Level;
  slide: number;
  quotes: string[];
}

export interface SessionResults {
  sessionId: string;
  topic: string;
  confidence: number;
  understanding: number;
  illusionScore: number;
  strongestMoment: string;
  reviseNext: string;
  concepts: ResultsConcept[];
  duckLearned: string[];
  recall: { conceptId: string; due: string }[];
}

export interface Course {
  id: string;
  userId: string;
  name: string;
}

export interface Section {
  id: string;
  courseId: string;
  name: string;
  type: SectionType;
}

/**
 * Upload progress, from `POST` and `GET /api/sections/:id/upload`. The first three fields
 * are the original contract; the rest were added in B8 and are all optional for old callers.
 */
export interface UploadJob {
  status: "processing" | "ready" | "error";
  sectionId: string;
  documentId?: string;
  filename?: string;
  pageCount?: number;
  /** Pages with no text. The browser renders each to a JPEG and sends it to
   *  `POST /api/documents/:documentId/pages/:n`. Empty when nothing is waiting. */
  imagePagesPending?: number[];
  /** Set when status is "error". Safe to show the student. */
  error?: string;
  /** Set when status is "ready". Never contains answers or reference code. */
  concepts?: Concept[];
}

export interface DueRecall {
  conceptId: string;
  name: string;
  topic: string;
  due: string;
  stateAfter: ConceptState;
}

export interface TurnLogRow {
  id: string;
  sessionId: string;
  n: number;
  text: string;
  startedAt: string;
  endedAt: string;
  signals: string[];
  scoreAfter: number;
  level: Level | null;
  moveKind: MoveKind;
  line: string;
}

export type DecisionSource = "student" | "silence" | "steer";

/** One row of the decision log (B14). Never includes a stored answer. */
export interface DecisionLogRow {
  id: string;
  sessionId: string;
  n: number;
  source: DecisionSource;
  text: string;
  startedAt: string;
  endedAt: string;
  signals: string[];
  scoreAfter: number | null;
  level: Level | null;
  moveKind: MoveKind | null;
  line: string;
  conceptId: string | null;
  conceptName: string | null;
  meta: Record<string, unknown>;
}

export interface SessionLog {
  sessionId: string;
  topic: string;
  turns: DecisionLogRow[];
}

export interface Profile {
  userId: string;
  calibration: string;
  pace: string;
  nagginess: string;
  teachingHabits: string[];
  tone: string;
  configOverrides: Partial<DuckConfig>;
  duckLearned: string[];
  updatedAt: string;
}

// Dev A implements. Returns structure only, never speech. A quote must appear verbatim in the turn text or the item is dropped.
export interface JudgeResult {
  covered: { conceptId: string; quote: string }[];
  missed: { conceptId: string }[];            // only filled when the explanation turn has ended
  misconceptions: { conceptId: string; quote: string }[];
  contradictions: { conceptId: string; quotes: [string, string] }[];
  vague: { conceptId: string; quote: string }[];
}
export declare function judgeTurn(input: { text: string; concepts: ConceptForJudge[]; explanationTurnEnded: boolean }): Promise<JudgeResult>;

// Dev A implements. Returns one spoken line, 20 words or fewer, at most one question mark.
export declare function wordMove(input: { kind: MoveKind; level: Level; conceptName: string; slide?: number; studentWords: string; toneHint?: string }): Promise<string>;

// Dev A implements. Every returned line must carry a student quote from the turn log.
export declare function summarizeProfile(input: { turns: TurnLogRow[]; previous?: Profile }): Promise<Profile>;
