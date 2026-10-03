import { DUCK, EXTRACT } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import { wordCount } from "../engine/wording";

// Everything Grok returns is checked here before it is saved. Code decides what is
// accepted; the AI only proposes. A concept that fails a check is dropped (or, for a
// trace question without usable code, turned into a plain explain question).

export type ConceptKind = "explain" | "trace" | "predict";

export interface ExtractedConcept {
  topic: string;
  name: string;
  /** Page number in the uploaded file. */
  slide: number;
  kind: ConceptKind;
  misconceptions: string[];
  checkPrompt: string;
  /** The check question states a wrong claim for the student to catch. Only for kind "explain". */
  plantsMisconception: boolean;
  fallbackQuestions: { L1: string; L2: string; L3: string; L4: string };
  /** Server only. Goes to concept_secrets, never to an API response or an AI prompt. */
  secret?: { referenceCode: string; expectedAnswer: string };
}

export interface ValidationResult {
  concepts: ExtractedConcept[];
  /** Why things were dropped or changed. For logs, never shown to the student. */
  problems: string[];
}

type Limits = Pick<DuckConfig, "maxDuckWords"> & typeof EXTRACT;

const KINDS: ConceptKind[] = ["explain", "trace", "predict"];
const MAX_TEXT = 120;
const MAX_CODE = 2_000;
const MAX_ANSWER = 200;
const MAX_MISCONCEPTIONS = 3;

const clean = (value: unknown, max: number): string => {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? "" : text;
};

const questionMarks = (line: string): number => (line.match(/\?/g) ?? []).length;
const squash = (text: string): string => text.toLowerCase().replace(/\s+/g, "");

/** Why a spoken line is not acceptable, or null if it is fine. */
export function lineProblem(
  line: string,
  limit: number,
  options: { mustEndWithQuestion?: boolean; mustMentionSlide?: number; answer?: string } = {},
): string | null {
  if (!line) return "empty";
  if (wordCount(line) > limit) return `over ${limit} words`;
  if (questionMarks(line) !== 1) return "needs exactly one question";
  if (options.mustEndWithQuestion && !line.endsWith("?")) return "must end with the question";
  if (options.mustMentionSlide !== undefined) {
    const match = line.match(/slide\s*(\d+)/i);
    if (!match || Number(match[1]) !== options.mustMentionSlide) {
      return `must name slide ${options.mustMentionSlide}`;
    }
  }
  if (options.answer && options.answer.length >= 3 && squash(line).includes(squash(options.answer))) {
    return "states the answer";
  }
  return null;
}

/** Take the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseJsonReply(reply: string): unknown {
  const text = reply.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

export function validateExtraction(
  raw: unknown,
  pageCount: number,
  limits: Limits = { ...EXTRACT, maxDuckWords: DUCK.maxDuckWords },
): ValidationResult {
  const problems: string[] = [];
  const list = (raw as { concepts?: unknown } | null)?.concepts;
  if (!Array.isArray(list)) {
    return { concepts: [], problems: ["reply has no concepts array"] };
  }

  const concepts: ExtractedConcept[] = [];
  const seen = new Set<string>();

  list.forEach((item, index) => {
    const label = `concept ${index + 1}`;
    const c = (item ?? {}) as Record<string, unknown>;
    const topic = clean(c.topic, MAX_TEXT);
    const name = clean(c.name, MAX_TEXT);
    if (!topic || !name) {
      problems.push(`${label}: missing topic or name`);
      return;
    }
    const where = `${label} (${name})`;

    const slide = c.slide;
    if (typeof slide !== "number" || !Number.isInteger(slide) || slide < 1 || slide > pageCount) {
      problems.push(`${where}: slide ${String(slide)} is not a page of this file`);
      return;
    }

    const key = `${topic}|${name}`.toLowerCase();
    if (seen.has(key)) {
      problems.push(`${where}: duplicate`);
      return;
    }

    let kind: ConceptKind = KINDS.includes(c.kind as ConceptKind) ? (c.kind as ConceptKind) : "explain";
    if (c.kind !== kind) problems.push(`${where}: unknown kind, treated as explain`);

    let secret: ExtractedConcept["secret"];
    if (kind !== "explain") {
      const referenceCode = typeof c.referenceCode === "string" ? c.referenceCode.trim() : "";
      const expectedAnswer = clean(c.expectedAnswer, MAX_ANSWER);
      if (referenceCode && referenceCode.length <= MAX_CODE && expectedAnswer) {
        secret = { referenceCode, expectedAnswer };
      } else {
        problems.push(`${where}: ${kind} question without usable code and answer, treated as explain`);
        kind = "explain";
      }
    }
    const answer = secret?.expectedAnswer;
    // A trace or prediction question is useless unless it gives the student the input values.
    if (kind !== "explain" && !/\d/.test(c.checkPrompt as string)) {
      problems.push(`${where}: check question gives no input values to work from`);
      return;
    }

    const checkPrompt = clean(c.checkPrompt, 300);
    const checkProblem = lineProblem(checkPrompt, limits.checkPromptMaxWords, {
      mustEndWithQuestion: true,
      answer,
    });
    if (checkProblem) {
      problems.push(`${where}: check question ${checkProblem}`);
      return;
    }

    const q = (c.fallbackQuestions ?? {}) as Record<string, unknown>;
    const lines = {
      L1: clean(q.L1, 300),
      L2: clean(q.L2, 300),
      L3: clean(q.L3, 300),
      L4: clean(q.L4, 400),
    };
    const lineProblems = [
      ["L1", lineProblem(lines.L1, limits.maxDuckWords, { answer })],
      ["L2", lineProblem(lines.L2, limits.maxDuckWords, { mustMentionSlide: slide, answer })],
      ["L3", lineProblem(lines.L3, limits.maxDuckWords, { answer })],
      ["L4", lineProblem(lines.L4, limits.maxDuckWords, { mustEndWithQuestion: true, answer })],
    ].filter((entry): entry is [string, string] => entry[1] !== null);
    if (lineProblems.length > 0) {
      problems.push(`${where}: ${lineProblems.map(([level, why]) => `${level} ${why}`).join(", ")}`);
      return;
    }

    const misconceptions = (Array.isArray(c.misconceptions) ? c.misconceptions : [])
      .map((m) => clean(m, MAX_TEXT))
      .filter(Boolean)
      .slice(0, MAX_MISCONCEPTIONS);

    seen.add(key);
    concepts.push({
      topic,
      name,
      slide,
      kind,
      misconceptions,
      checkPrompt,
      plantsMisconception: kind === "explain" && c.plantsMisconception === true && misconceptions.length > 0,
      fallbackQuestions: lines,
      ...(secret ? { secret } : {}),
    });
  });

  concepts.sort((a, b) => a.slide - b.slide);
  if (concepts.length > limits.maxConcepts) {
    problems.push(`kept the first ${limits.maxConcepts} of ${concepts.length} concepts`);
    concepts.length = limits.maxConcepts;
  }
  return { concepts, problems };
}
