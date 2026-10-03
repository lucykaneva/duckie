// "I am not sure" answered a planted wrong claim, and the judge called it a misconception.
// Uncertainty is not a belief: code drops it whatever Grok says.
import { describe, expect, it } from "vitest";
import { cleanJudgeResult, isOnlyUncertainty } from "../src/lib/prompts/judgeTurn";

describe("isOnlyUncertainty", () => {
  it("is true for plain 'I don't know' style answers", () => {
    for (const q of ["I am not sure", "I'm not sure.", "no idea", "Um, I don't know", "hmm maybe I guess", "I have no idea"]) {
      expect(isOnlyUncertainty(q), q).toBe(true);
    }
  });

  it("is false when the student actually says something about the topic", () => {
    for (const q of ["I think it's fine", "it loops forever", "they have to be sorted", "lo equals mid is okay"]) {
      expect(isOnlyUncertainty(q), q).toBe(false);
    }
  });
});

describe("cleanJudgeResult", () => {
  const input = {
    text: "I am not sure.",
    concepts: [{ id: "c_15", name: "The update step", misconceptions: ["lo = mid is fine"] }],
    explanationTurnEnded: false,
  };

  it("drops a misconception whose quote is only uncertainty", () => {
    const raw = { concepts: [{ conceptId: "c_15", covered: null, misconception: "I am not sure", vague: null, contradiction: null }] };
    expect(cleanJudgeResult(raw, input).misconceptions).toEqual([]);
  });

  it("keeps a real misconception", () => {
    const real = { ...input, text: "I think lo equals mid is fine." };
    const raw = { concepts: [{ conceptId: "c_15", covered: null, misconception: "lo equals mid is fine", vague: null, contradiction: null }] };
    expect(cleanJudgeResult(raw, real).misconceptions).toHaveLength(1);
  });
});
