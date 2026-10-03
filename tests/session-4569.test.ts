// Replays the problems from a real /dev/voice session (s_4569e787).
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { ENGINE } from "../src/lib/duck/config";
import { detectClarification, detectMoveOn } from "../src/lib/engine/signals";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { lineProblem } from "../src/lib/prompts/wordMove";

ENGINE.reinforceAfterCorrect = false;

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

describe("'I am not sure what a sorted input is. Can you explain?' (turn 2)", () => {
  const TEXT = "I am not sure what a sorted input is. I am not sure what a sorted input is. Can you explain?";

  it("is a question about the duck's own words", () => {
    expect(detectClarification(TEXT)).toBe(true);
    expect(detectClarification("What is a sorted input?")).toBe(true);
    expect(detectClarification("What's left is the right half so you search that")).toBe(false);
  });

  it("is answered with an open reply (the duck explains its words), not a new quiz question", () => {
    const started = { ...freshSession(defs), turnCount: 1, lastMoveKind: "open" as const, lastLine: "Can you explain sorted input to me?" };
    const out = turn(started, TEXT);
    expect(out.move.kind).toBe("open");
    expect(out.signals).toEqual([]);
  });
});

describe("'I want an example, and you're asking me want to skip this one.' (turn 8)", () => {
  it("is a complaint, not a request to skip", () => {
    expect(detectMoveOn("I want an example, and you're asking me want to skip this one.")).toBe(false);
  });
  it("a real request still skips", () => {
    for (const t of ["skip this one", "Let's skip this", "okay, skip this one please", "I want to skip"]) {
      expect(detectMoveOn(t), t).toBe(true);
    }
  });
});

describe("'Can you give me an example for that?' after the ladder is used up (turn 7)", () => {
  function usedUp(moves = 5): SessionRun {
    const run = freshSession(defs);
    const c = run.concepts.find((x) => x.conceptId === "c_12")!;
    Object.assign(c, { levelReached: "L4", moves, failedAttempts: 4, score: 0.55 });
    return { ...run, turnCount: 7, focusConceptId: "c_12", lastMoveKind: "question", lastLine: "Why does that let us drop half each time?" };
  }

  it("gets another small example, not a skip offer", () => {
    const out = turn(usedUp(), "Can you give me an example for that?");
    expect(out.move.kind).not.toBe("offer_skip");
    expect(out.move.level).toBe("L3");
    expect(out.move.line).toBe(defs.find((d) => d.id === "c_12")!.fallbackQuestions.L3);
  });

  it("stops after a couple of extra helps and then offers to skip", () => {
    const out = turn(usedUp(ENGINE.helpRequestMovesBeyondCap + 3), "Can you give me another example?");
    expect(out.move.kind).toBe("offer_skip");
  });

  it("offers to skip as before when the student did not ask for help", () => {
    const out = turn(usedUp(), "Hmm, I'm not sure about that.");
    expect(out.move.kind).toBe("offer_skip");
  });
});

describe("the duck does not echo the student or confirm a wrong answer", () => {
  const q = { kind: "question", level: "L1" } as const;
  it("rejects a line that starts with the student's words", () => {
    expect(lineProblem("Yeah. So when does it stop then?", { ...q, studentWords: "Yeah." })).toMatch(/repeating the student/);
    expect(lineProblem("Are you stupid? Ooh, can you explain sorted input to me.", { kind: "open", level: "L0", studentWords: "Are you stupid?" })).toMatch(/repeating the student/);
    expect(lineProblem("Find the target. So when the pointers meet it stops too?", { ...q, studentWords: "Find the target." })).toMatch(/repeating the student/);
    expect(lineProblem("No, can you try the list 2 4?", { ...q, studentWords: "No, can you explain it?" })).toMatch(/repeating the student/);
  });

  it("rejects 'Oh right, ...' on a question or open prompt", () => {
    expect(lineProblem("Oh right, seven and nine. So when does it stop then?", { kind: "open", level: "L0", studentWords: "Seven and nine. Five seven." })).toMatch(
      /confirms or praises|repeating/,
    );
    expect(lineProblem("Exactly. What happens at the end?", { ...q, studentWords: "It goes to the end" })).toMatch(/confirms or praises/);
  });

  it("accepts a normal line, and a reinforce that uses the student's words", () => {
    expect(lineProblem("What happens when the number is missing?", { ...q, studentWords: "Yeah." })).toBeNull();
    expect(lineProblem("Shrinks by half, yes. Can you say it in your own words?", { kind: "reinforce", level: "L2", studentWords: "Shrinks by half." })).toBeNull();
  });
});
