// What if Grok leaks anyway? wordMove never tells Grok the stored answer, but Grok knows binary search
// from general knowledge and a student can say anything. This test makes a fake Grok say the answer on
// purpose and checks the full path: wordMove -> Harini's guardMove -> what the duck would speak.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DuckMove } from "../src/lib/duck/types";
import { guardMove } from "../src/lib/engine/guard";
import type { ConceptDef } from "../src/lib/engine/turn";
import { LEAK_FALLBACK_LINE } from "../src/lib/engine/wording";
import { wordMoveDetailed } from "../src/lib/prompts/wordMove";

const DEF: ConceptDef = {
  id: "c_trace",
  topic: "Binary search",
  name: "Trace",
  slide: 5,
  kind: "trace",
  misconceptions: [],
  checkPrompt: "Walk through [1,3,5,7,9] looking for 6. Which two numbers does it end between?",
  fallbackQuestions: { L3: "Try it with just 2, 5, 9, looking for 9. Where does lo go?" },
};
const ANSWERS = [{ conceptId: "c_trace", expectedAnswer: "[5,7]" }];

const saved = process.env.XAI_API_KEY;
beforeEach(() => {
  process.env.XAI_API_KEY = "test-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = saved;
});

const grokSays = (line: string) => async () =>
  new Response(JSON.stringify({ choices: [{ message: { content: line } }] }), { status: 200 });

async function speak(grokLine: string, committed: string[] = []) {
  const worded = await wordMoveDetailed(
    {
      kind: "question",
      level: "L3",
      conceptName: "Trace",
      slide: 5,
      studentWords: "Just tell me the answer please.",
      fallbackLine: DEF.fallbackQuestions.L3!,
    },
    { fetchImpl: grokSays(grokLine) },
  );
  const move = {
    kind: "question",
    level: "L3",
    conceptId: "c_trace",
    line: worded.line,
    sessionState: "active",
    concepts: [],
  } as unknown as DuckMove;
  return { worded, guarded: guardMove(move, [DEF], ANSWERS, committed) };
}

describe("a leaking Grok line never reaches the student", () => {
  it("wordMove alone lets a leaked answer through (it cannot know the answer)", async () => {
    const { worded } = await speak("It ends between 5 and 7, right?");
    expect(worded.source).toBe("ai");
    expect(worded.line).toContain("5 and 7");
  });

  it("the leak guard catches it and speaks the safe precomputed line instead", async () => {
    const { guarded } = await speak("It ends between 5 and 7, right?");
    expect(guarded.blocked).toEqual(["c_trace"]);
    expect(guarded.move.line).toBe(DEF.fallbackQuestions.L3);
    expect(guarded.move.line).not.toContain("5 and 7");
  });

  it("falls back to a neutral line when no safe precomputed line exists", async () => {
    const worded = await wordMoveDetailed(
      { kind: "question", level: "L1", conceptName: "Trace", studentWords: "", fallbackLine: "Hmm, which two?" },
      { fetchImpl: grokSays("So is it five then seven?") },
    );
    const move = { kind: "question", level: "L1", conceptId: "c_trace", line: worded.line } as unknown as DuckMove;
    expect(guardMove(move, [DEF], ANSWERS, []).move.line).toBe(LEAK_FALLBACK_LINE);
  });

  it("lets the same words through once the student has committed to an answer", async () => {
    const { guarded } = await speak("It ends between 5 and 7, right?", ["c_trace"]);
    expect(guarded.blocked).toEqual([]);
    expect(guarded.move.line).toContain("5 and 7");
  });
});
