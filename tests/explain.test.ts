// Asking the duck to explain, or what it meant. Two real-session bugs:
//  - "I am not sure. Can you explain that?" came back as an open prompt: "Can you explain when binary search stops then?"
//  - "No, can you explain it?" got a tiny example that began "No, can you ...", never an explanation.
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { DUCK, ENGINE } from "../src/lib/duck/config";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { detectExplainRequest } from "../src/lib/engine/signals";
import { freshSession, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { isWorded, lineProblem } from "../src/lib/prompts/wordMove";

ENGINE.reinforceAfterCorrect = false; // not what these tests are about

const defs: ConceptDef[] = SEED_CONCEPTS.map((c) => ({
  id: c.id,
  topic: c.topic,
  name: c.name,
  slide: c.slide,
  kind: c.kind,
  misconceptions: c.misconceptions,
  checkPrompt: c.checkPrompt,
  plantsMisconception: c.plantsMisconception,
  fallbackQuestions: c.fallbackQuestions,
}));
const turn = (s: SessionRun, text: string) => processTurn(defs, s, { text, judge: emptyJudgeResult(), nowMs: 60_000 });

/** The student answered the trace wrong, got an L1 hint, and the duck has asked questions back to back. */
function afterOneHint(streak = DUCK.maxQuestionStreak): SessionRun {
  const run = freshSession(defs);
  const c = run.concepts.find((x) => x.conceptId === "c_14")!;
  Object.assign(c, { levelReached: "L1", moves: 2, score: 0.3, failedAttempts: 1 });
  return {
    ...run,
    turnCount: 4,
    focusConceptId: "c_14",
    lastMoveKind: "question",
    lastLine: "Why do you think seven and nine?",
    questionStreak: streak,
  };
}

describe("detectExplainRequest", () => {
  it("hears a request to be explained to", () => {
    for (const t of ["Can you explain it?", "No, can you explain it?", "I am not sure. Can you explain that?", "please explain", "I don't understand it"]) {
      expect(detectExplainRequest(t), t).toBe(true);
    }
  });
  it("does not hear the student teaching, or asking for only a hint", () => {
    for (const t of ["Let me explain it: you halve the list", "I can explain that", "Give me a hint", "It explains the middle"]) {
      expect(detectExplainRequest(t), t).toBe(false);
    }
  });
});

describe("asking the duck to explain", () => {
  it("is never bounced back as an open prompt, however many questions came before", () => {
    const out = turn(afterOneHint(), "I am not sure. Can you explain that?");
    expect(out.move.kind).not.toBe("open");
  });

  it("gets the explanation (L4, then a teach-back) once the student has already had a hint", () => {
    const out = turn(afterOneHint(), "No, can you explain it?");
    expect(out.move.level).toBe("L4");
    expect(out.move.line).toBe(defs.find((d) => d.id === "c_14")!.fallbackQuestions.L4);
    expect(out.session.concepts.find((c) => c.conceptId === "c_14")!.failedAttempts).toBe(1); // asking is not a failed attempt
  });

  it("is still just a hint (L3) when it is the student's very first ask", () => {
    const run = freshSession(defs);
    const c = run.concepts.find((x) => x.conceptId === "c_14")!;
    Object.assign(c, { levelReached: "L0", moves: 1 });
    const out = turn(
      { ...run, turnCount: 2, focusConceptId: "c_14", lastMoveKind: "question", lastLine: "Which numbers do you check?" },
      "Can you explain it?",
    );
    expect(out.move.level).toBe("L3");
  });
});

describe("what do you mean, in the words", () => {
  it("rewords the duck's own line even for the opening question (level L0)", () => {
    expect(isWorded({ kind: "rephrase", level: "L0", studentAsked: "clarify" })).toBe(true);
    expect(isWorded({ kind: "rephrase", level: "L0" })).toBe(true);
  });

  it("must explain, not hand the student's question back", () => {
    const input = { kind: "rephrase", level: "L1", studentAsked: "clarify" } as const;
    expect(lineProblem("They're just the numbers in your list. Does the order matter?", input)).toBeNull();
    expect(lineProblem("What do you mean by pebbles?", input)).toMatch(/hands the student's own question back/);
    expect(lineProblem("What does that mean?", input)).toMatch(/hands the student's own question back/);
  });

  it("does not demand a slide at L2 for an explanation of its own words", () => {
    const input = { kind: "rephrase", level: "L2", slide: 4, studentAsked: "clarify" } as const;
    expect(lineProblem("They're just the numbers in your list.", input)).toBeNull();
  });
});
