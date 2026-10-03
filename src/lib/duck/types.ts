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

export interface UploadJob {
  status: "processing" | "ready" | "error";
  sectionId: string;
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
