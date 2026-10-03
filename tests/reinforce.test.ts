// Two ways the duck answers what the student just said:
//  - right: confirm it, add one small hint, and ask them to say it back (a "reinforce" move), then move on
//  - wrong: ask why they think that and add a small hint, never the answer
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { DUCK, ENGINE } from "../src/lib/duck/config";
import type { JudgeResult } from "../src/lib/duck/types";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { REINFORCE_LINE, wordCount } from "../src/lib/engine/wording";
import { isWorded, lineProblem, wordMoveDetailed, type WordMoveInput } from "../src/lib/prompts/wordMove";

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

const judge = (parts: Partial<JudgeResult>): JudgeResult => ({ ...emptyJudgeResult(), ...parts });
const turn = (s: SessionRun, text: string, parts: Partial<JudgeResult> = {}) =>
  processTurn(defs, s, { text, judge: judge(parts), nowMs: 60_000 });

/** The duck asked about concept `id` and the student has not answered yet. */
function asking(id: string, extra: Partial<SessionRun["concepts"][number]> = {}): SessionRun {
  const s = freshSession(defs);
  const c = s.concepts.find((x) => x.conceptId === id)!;
  Object.assign(c, { moves: 1, ...extra });
  return { ...s, turnCount: 2, focusConceptId: id, lastMoveKind: "question", lastLine: "A question." };
}

const saved = ENGINE.reinforceAfterCorrect;
beforeEach(() => {
  ENGINE.reinforceAfterCorrect = true;
});
afterEach(() => {
  ENGINE.reinforceAfterCorrect = saved;
});

describe("a right answer is reinforced", () => {
  const RIGHT = "No, they have to be sorted, or you could throw away the half with the target.";
  const covered = { covered: [{ conceptId: "c_12", quote: "they have to be sorted" }] };

  it("confirms, then asks the student to say it back before the next question", () => {
    const first = turn(asking("c_12", { levelReached: "L1", score: 0.3 }), RIGHT, covered);
    expect(first.resolved).toHaveLength(1);
    expect(first.move.kind).toBe("reinforce");
    expect(first.move.conceptId).toBe("c_12");
    expect(first.move.line).toBe(REINFORCE_LINE);
    expect(first.session.pending).toBeNull();

    // Their restatement is not scored; the duck then moves on to the next idea.
    const second = turn(first.session, "It has to be in order, so I can throw away half each time.");
    expect(second.move.kind).toBe("question");
    expect(second.move.conceptId).not.toBe("c_12");
  });

  it("keeps the concept's state as it was (assisted after help, not changed by the restate)", () => {
    const first = turn(asking("c_12", { levelReached: "L1", score: 0.3 }), RIGHT, covered);
    const after = turn(first.session, "Um, I think it needs to be sorted.");
    expect(after.session.concepts.find((c) => c.conceptId === "c_12")!.state).toBe("assisted");
  });

  it("celebrates first when the success was earned, then asks them to say it back", () => {
    const o = turn(asking("c_12", { levelReached: "L2", score: 0.6 }), RIGHT, covered);
    expect(o.move.kind).toBe("celebrate");
    expect(o.move.then?.kind).toBe("reinforce");
  });

  it("repeats the restate question if they ask what it meant", () => {
    const first = turn(asking("c_12", { levelReached: "L1", score: 0.3 }), RIGHT, covered);
    const again = turn(first.session, "What do you mean?");
    expect(again.move.kind).toBe("reinforce");
    expect(again.move.line).toBe(first.move.line);
  });

  it("is skipped after an L4 explanation, which already ended in a teach-back", () => {
    const o = turn(
      asking("c_12", { levelReached: "L4", score: 0.3, moves: 4, failedAttempts: 3 }),
      "it only works sorted so you can throw half away",
      { covered: [{ conceptId: "c_12", quote: "only works sorted" }] },
    );
    expect(o.move.kind).not.toBe("reinforce");
  });

  it("can be switched off in the config", () => {
    ENGINE.reinforceAfterCorrect = false;
    const o = turn(asking("c_12", { levelReached: "L1", score: 0.3 }), RIGHT, covered);
    expect(o.move.kind).toBe("question");
  });

  it("has a backup line that follows the duck's rules", () => {
    expect(wordCount(REINFORCE_LINE)).toBeLessThanOrEqual(DUCK.maxDuckWords);
    expect((REINFORCE_LINE.match(/\?/g) ?? []).length).toBe(1);
  });
});

// ---- the wording ----------------------------------------------------------------------------------

function fakeGrok(reply: string) {
  const bodies: Array<{ messages: { role: string; content: string }[] }> = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  };
  return { fetchImpl, bodies };
}

const BASE: WordMoveInput = {
  kind: "question",
  level: "L1",
  conceptName: "Sorted input",
  studentWords: "I think it works on any list.",
  fallbackLine: "What happens to lo when it's right next to hi?",
};

describe("wording a reinforce move", () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = "test-key";
  });

  it("is always reworded, and must end by asking them to say it back as one question", () => {
    expect(isWorded({ kind: "reinforce", level: "L1" })).toBe(true);
    const input = { kind: "reinforce", level: "L2", slide: 4 } as const;
    expect(lineProblem("Yes, sorted. Say it back to me in your own words?", input)).toBeNull();
    expect(lineProblem("Yes, that is sorted.", input)).toMatch(/say it back/);
    expect(lineProblem("Yes? Why? Say it back?", input)).toMatch(/more than one question/);
  });

  it("does not demand a slide mention at L2 (that rule is for hints)", async () => {
    const g = fakeGrok("Yes, it has to be sorted. Can you say why in your own words?");
    const out = await wordMoveDetailed(
      { ...BASE, kind: "reinforce", level: "L2", slide: 4, fallbackLine: REINFORCE_LINE },
      { fetchImpl: g.fetchImpl },
    );
    expect(out.source).toBe("ai");
    expect(g.bodies[0].messages[1].content).toMatch(/say it back/);
  });
});

describe("wording a reply to a wrong answer", () => {
  beforeEach(() => {
    process.env.XAI_API_KEY = "test-key";
  });

  it("tells Grok to ask why they think that and add a small hint", async () => {
    const g = fakeGrok("Oh, why do you think that? Try it with a messy list.");
    await wordMoveDetailed({ ...BASE, studentWas: "wrong" }, { fetchImpl: g.fetchImpl });
    const task = g.bodies[0].messages[1].content;
    expect(task).toMatch(/why they think that/);
    expect(task).toMatch(/small hint/);
    expect(task).toMatch(/never say it is wrong/i);
  });

  it("does not use that wording for a student who was not wrong", async () => {
    const g = fakeGrok("Wait, what if the list is messy?");
    await wordMoveDetailed(BASE, { fetchImpl: g.fetchImpl });
    expect(g.bodies[0].messages[1].content).not.toMatch(/why they think that/);
  });

  it("rejects a reply with no question, and retries once", async () => {
    expect(lineProblem("Look at slide 4 again.", { ...BASE, studentWas: "wrong", level: "L3" })).toMatch(
      /why they think that/,
    );
    expect(lineProblem("Oh, why do you think that? Try 2, 5, 9.", { ...BASE, studentWas: "wrong", level: "L3" })).toBeNull();
  });

  it("leaves the L4 explanation alone: that one explains, then asks them to say it back", async () => {
    const g = fakeGrok("It only works on sorted lists, because half is thrown away. Can you say why?");
    await wordMoveDetailed({ ...BASE, level: "L4", studentWas: "wrong" }, { fetchImpl: g.fetchImpl });
    expect(g.bodies[0].messages[1].content).not.toMatch(/why they think that/);
  });
});
