import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ConceptForJudge } from "../src/lib/duck/types";
import { cleanJudgeResult, judgeTurn } from "../src/lib/prompts/judgeTurn";
import { findQuote } from "../src/lib/prompts/quotes";
import { AiError } from "../src/lib/prompts/xai";

const CONCEPTS: ConceptForJudge[] = [
  { id: "c_sorted", name: "Sorted input", misconceptions: ["Binary search works on any list"] },
  { id: "c_halving", name: "Halving", misconceptions: [] },
  { id: "c_stops", name: "When it stops", misconceptions: [] },
  { id: "c_update", name: "The update step", misconceptions: ["lo = mid is fine"] },
  { id: "c_log", name: "O(log n)", misconceptions: [] },
];

// Turn 2 of the spec's worked example.
const TURN_2 =
  "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.";

describe("findQuote", () => {
  it("returns the student's own words for an exact quote", () => {
    // Trailing punctuation is not part of the words, so it is not part of the quote.
    expect(findQuote(TURN_2, "You keep halving.")).toBe("You keep halving");
  });

  it("ignores case, punctuation and spacing, and returns the original slice", () => {
    expect(findQuote(TURN_2, "if the targets bigger you go right otherwise left")).toBeNull(); // "targets" != "target's"
    expect(findQuote(TURN_2, "IF THE TARGET'S BIGGER, you go right")).toBe("If the target's bigger you go right");
    expect(findQuote(TURN_2, "you   keep\nhalving")).toBe("You keep halving");
  });

  it("handles curly apostrophes", () => {
    expect(findQuote("I think it\u2019s fine", "it's fine")).toBe("it\u2019s fine");
  });

  it("rejects words the student never said", () => {
    expect(findQuote(TURN_2, "You must sort the list first")).toBeNull();
    expect(findQuote(TURN_2, "the list has to be sorted")).toBeNull();
  });

  it("does not match inside a longer word", () => {
    expect(findQuote("it works on sorted lists", "on sort")).toBeNull();
    expect(findQuote("it works on sorted lists", "works on sorted")).toBe("works on sorted");
  });

  it("rejects a one-word quote and non-strings", () => {
    expect(findQuote(TURN_2, "halving")).toBeNull();
    expect(findQuote(TURN_2, 42)).toBeNull();
    expect(findQuote(TURN_2, "")).toBeNull();
  });
});

// One verdict per concept, as Grok is asked to return them.
const verdict = (conceptId: string, fields: Record<string, unknown> = {}) => ({
  conceptId,
  covered: null,
  misconception: null,
  vague: null,
  contradiction: null,
  ...fields,
});

describe("cleanJudgeResult", () => {
  const input = { text: TURN_2, concepts: CONCEPTS, explanationTurnEnded: true };

  it("keeps items with a real quote", () => {
    const result = cleanJudgeResult(
      { concepts: [verdict("c_halving", { covered: "You keep halving." })] },
      input,
    );
    expect(result.covered).toEqual([{ conceptId: "c_halving", quote: "You keep halving" }]);
  });

  it("decides missed in code: every concept with no surviving evidence, once the turn has ended", () => {
    const result = cleanJudgeResult(
      { concepts: [verdict("c_halving", { covered: "You keep halving" })] },
      input,
    );
    expect(result.missed.map((m) => m.conceptId)).toEqual(["c_sorted", "c_stops", "c_update", "c_log"]);
  });

  it("never reports missed while the explanation turn is still going", () => {
    const result = cleanJudgeResult({ concepts: [] }, { ...input, explanationTurnEnded: false });
    expect(result.missed).toEqual([]);
  });

  it("drops an item whose quote is invented, and then counts the concept as missed", () => {
    const result = cleanJudgeResult(
      {
        concepts: [
          verdict("c_sorted", {
            covered: "the list has to be sorted first",
            misconception: "it works on any list",
          }),
          verdict("c_halving", { vague: "it just works" }),
        ],
      },
      input,
    );
    expect(result.covered).toEqual([]);
    expect(result.misconceptions).toEqual([]);
    expect(result.vague).toEqual([]);
    expect(result.missed.map((m) => m.conceptId)).toContain("c_sorted");
    expect(result.missed.map((m) => m.conceptId)).toContain("c_halving");
  });

  it("a misconception or vague answer counts as addressed, so not missed", () => {
    const text = "I think that's fine? It just works.";
    const result = cleanJudgeResult(
      {
        concepts: [
          verdict("c_update", { misconception: "I think that's fine" }),
          verdict("c_log", { vague: "It just works" }),
        ],
      },
      { ...input, text },
    );
    expect(result.misconceptions).toEqual([{ conceptId: "c_update", quote: "I think that's fine" }]);
    expect(result.vague).toEqual([{ conceptId: "c_log", quote: "It just works" }]);
    expect(result.missed.map((m) => m.conceptId)).toEqual(["c_sorted", "c_halving", "c_stops"]);
  });

  it("ignores unknown concepts and repeated entries", () => {
    const result = cleanJudgeResult(
      {
        concepts: [
          verdict("c_nope", { covered: "You keep halving" }),
          verdict("c_halving", { covered: "You keep halving" }),
          verdict("c_halving", { covered: "You look at the middle" }),
        ],
      },
      input,
    );
    expect(result.covered).toEqual([{ conceptId: "c_halving", quote: "You keep halving" }]);
  });

  it("needs two different real quotes for a contradiction", () => {
    const text = "It stays the same. Actually it moves up by one. So it loops forever.";
    const base = { ...input, text };
    const ok = cleanJudgeResult(
      { concepts: [verdict("c_update", { contradiction: ["It stays the same", "it moves up by one"] })] },
      base,
    );
    expect(ok.contradictions).toEqual([
      { conceptId: "c_update", quotes: ["It stays the same", "it moves up by one"] },
    ]);
    expect(ok.missed.map((m) => m.conceptId)).not.toContain("c_update");

    const oneInvented = cleanJudgeResult(
      { concepts: [verdict("c_update", { contradiction: ["It stays the same", "it never changes"] })] },
      base,
    );
    expect(oneInvented.contradictions).toEqual([]);

    const same = cleanJudgeResult(
      { concepts: [verdict("c_update", { contradiction: ["It stays the same", "it stays the same"] })] },
      base,
    );
    expect(same.contradictions).toEqual([]);
  });

  it("survives garbage", () => {
    for (const raw of [null, undefined, "text", 5, [], { concepts: "no" }, { concepts: [null, 3, "x"] }]) {
      const result = cleanJudgeResult(raw, { ...input, explanationTurnEnded: false });
      expect(result).toEqual({ covered: [], missed: [], misconceptions: [], contradictions: [], vague: [] });
    }
  });
});

describe("judgeTurn", () => {
  const saved = process.env.XAI_API_KEY;
  beforeEach(() => {
    process.env.XAI_API_KEY = "test-key";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.XAI_API_KEY;
    else process.env.XAI_API_KEY = saved;
  });

  const reply = (content: string) => async () =>
    new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

  it("parses the reply and enforces the quote rule", async () => {
    const result = await judgeTurn(
      { text: TURN_2, concepts: CONCEPTS, explanationTurnEnded: true },
      {
        fetchImpl: reply(
          JSON.stringify({
            concepts: [
              verdict("c_halving", { covered: "You keep halving." }),
              verdict("c_sorted", { misconception: "any list works" }),
            ],
          }),
        ),
      },
    );
    expect(result.covered).toHaveLength(1);
    expect(result.misconceptions).toEqual([]);
    expect(result.missed.map((m) => m.conceptId)).toContain("c_sorted");
  });

  it("copes with code fences around the JSON", async () => {
    const result = await judgeTurn(
      { text: TURN_2, concepts: CONCEPTS, explanationTurnEnded: false },
      {
        fetchImpl: reply(
          "```json\n" + JSON.stringify({ concepts: [verdict("c_halving", { covered: "You keep halving" })] }) + "\n```",
        ),
      },
    );
    expect(result.covered).toHaveLength(1);
  });

  it("sends the student's text and the concept ids, and no secrets", async () => {
    let body = "";
    await judgeTurn(
      { text: TURN_2, concepts: CONCEPTS, explanationTurnEnded: false },
      {
        fetchImpl: async (_url, init) => {
          body = String(init.body);
          return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
        },
      },
    );
    expect(body).toContain("c_sorted");
    expect(body).toContain("You keep halving");
    expect(body).not.toContain("reference_code");
    expect(body).not.toContain("expected_answer");
  });

  it("does not call Grok for an empty turn", async () => {
    let called = false;
    const result = await judgeTurn(
      { text: "   ", concepts: CONCEPTS, explanationTurnEnded: true },
      {
        fetchImpl: async () => {
          called = true;
          return new Response("{}");
        },
      },
    );
    expect(called).toBe(false);
    expect(result.covered).toEqual([]);
  });

  it("throws AiError, not an empty result, when Grok fails", async () => {
    const input = { text: TURN_2, concepts: CONCEPTS, explanationTurnEnded: true };
    await expect(
      judgeTurn(input, { fetchImpl: async () => new Response("no", { status: 500 }) }),
    ).rejects.toMatchObject({ name: "AiError", reason: "http" });
    await expect(judgeTurn(input, { fetchImpl: reply("not json") })).rejects.toMatchObject({
      reason: "bad_output",
    });
    await expect(
      judgeTurn(input, {
        fetchImpl: async () => {
          throw new DOMException("timed out", "TimeoutError");
        },
      }),
    ).rejects.toMatchObject({ reason: "timeout" });
  });

  it("throws no_key without a key", async () => {
    delete process.env.XAI_API_KEY;
    await expect(
      judgeTurn({ text: TURN_2, concepts: CONCEPTS, explanationTurnEnded: true }),
    ).rejects.toBeInstanceOf(AiError);
  });
});
