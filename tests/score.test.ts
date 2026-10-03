import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import type { JudgeResult } from "../src/lib/duck/types";
import {
  addSignals,
  collectSignals,
  judgeSignals,
  quoteAppears,
  updateConceptScore,
} from "../src/lib/engine/score";

const emptyJudge: JudgeResult = {
  covered: [],
  missed: [],
  misconceptions: [],
  contradictions: [],
  vague: [],
};

describe("addSignals", () => {
  it("adds each signal's weight from the DUCK config", () => {
    expect(addSignals(0, ["dontKnow"])).toBe(DUCK.weights.dontKnow);
    expect(addSignals(0, ["wrongTrace"])).toBe(DUCK.weights.wrongTrace);
    expect(addSignals(0, ["misconception"])).toBe(DUCK.weights.misconception);
    expect(addSignals(0, ["conceptMissed"])).toBe(DUCK.weights.conceptMissed);
    expect(addSignals(0, ["contradiction"])).toBe(DUCK.weights.contradiction);
    expect(addSignals(0, ["silence"])).toBe(DUCK.weights.silence);
    expect(addSignals(0, ["vague"])).toBe(DUCK.weights.vague);
    expect(addSignals(0, ["hedging"])).toBe(DUCK.weights.hedging);
    expect(addSignals(0, ["fillers"])).toBe(DUCK.weights.fillers);
  });

  it("adds signals up across turns", () => {
    const first = addSignals(0, ["wrongTrace"]);
    const second = addSignals(first, ["wrongTrace"]);
    expect(first).toBe(0.3);
    expect(second).toBe(0.6); // a second wrong trace climbs higher
  });

  it("counts each signal once per call", () => {
    expect(addSignals(0, ["hedging", "hedging", "hedging"])).toBe(0.15);
  });

  it("caps at 1", () => {
    expect(addSignals(0.9, ["dontKnow"])).toBe(1);
    expect(addSignals(0, ["dontKnow", "wrongTrace", "misconception", "conceptMissed"])).toBe(1);
    expect(addSignals(1, ["fillers"])).toBe(1);
  });

  it("takes weights from the config it is given", () => {
    const tuned = { weights: { ...DUCK.weights, dontKnow: 0.1 } };
    expect(addSignals(0, ["dontKnow"], tuned)).toBe(0.1);
  });

  it("has no floating point drift at the earned threshold", () => {
    // 0.3 + 0.15 is 0.44999999999999996 in raw floats
    const score = addSignals(0, ["wrongTrace", "hedging"]);
    expect(score).toBe(0.45);
    expect(score >= DUCK.earnedScore).toBe(true);
  });
});

describe("quoteAppears", () => {
  it("accepts only the student's exact words", () => {
    const text = "No, they have to be sorted";
    expect(quoteAppears(text, "they have to be sorted")).toBe(true);
    expect(quoteAppears(text, "they must be sorted")).toBe(false);
    expect(quoteAppears(text, "THEY HAVE TO BE SORTED")).toBe(false);
  });

  it("rejects an empty quote", () => {
    expect(quoteAppears("anything", "")).toBe(false);
    expect(quoteAppears("anything", "   ")).toBe(false);
  });
});

describe("judge signals: quote or it doesn't count", () => {
  const text = "I think that's fine, it just works";

  it("counts misconception, contradiction and vague when the quotes are verbatim", () => {
    const judge: JudgeResult = {
      ...emptyJudge,
      misconceptions: [{ conceptId: "c_15", quote: "that's fine" }],
      contradictions: [{ conceptId: "c_15", quotes: ["I think", "it just works"] }],
      vague: [{ conceptId: "c_15", quote: "it just works" }],
    };
    expect(judgeSignals("c_15", text, judge, false)).toEqual([
      "misconception",
      "contradiction",
      "vague",
    ]);
  });

  it("drops items whose quote is not in the turn text", () => {
    const judge: JudgeResult = {
      ...emptyJudge,
      misconceptions: [{ conceptId: "c_15", quote: "lo equals mid" }],
      vague: [{ conceptId: "c_15", quote: "" }],
    };
    expect(judgeSignals("c_15", text, judge, false)).toEqual([]);
  });

  it("needs both quotes for a contradiction", () => {
    const judge: JudgeResult = {
      ...emptyJudge,
      contradictions: [{ conceptId: "c_15", quotes: ["I think", "it never works"] }],
    };
    expect(judgeSignals("c_15", text, judge, false)).toEqual([]);
  });

  it("ignores items for other concepts", () => {
    const judge: JudgeResult = {
      ...emptyJudge,
      misconceptions: [{ conceptId: "c_12", quote: "that's fine" }],
    };
    expect(judgeSignals("c_15", text, judge, false)).toEqual([]);
  });

  it("counts a missed concept only after the explanation turn has ended", () => {
    const judge: JudgeResult = { ...emptyJudge, missed: [{ conceptId: "c_12" }] };
    expect(judgeSignals("c_12", text, judge, false)).toEqual([]);
    expect(judgeSignals("c_12", text, judge, true)).toEqual(["conceptMissed"]);
  });

  it("does nothing without a judge result", () => {
    expect(judgeSignals("c_12", text, undefined, true)).toEqual([]);
  });
});

describe("collectSignals", () => {
  it("combines code, judge and external signals once each, in table order", () => {
    const text = "Um, I think 5, then 7, then maybe 9, I think";
    const signals = collectSignals({
      conceptId: "c_14",
      text,
      wrongTrace: true,
      silence: true,
      judge: { ...emptyJudge, vague: [{ conceptId: "c_14", quote: "then 7" }] },
    });
    expect(signals).toEqual(["wrongTrace", "silence", "vague", "hedging"]);
  });

  it("does not treat a request for help as a struggle signal", () => {
    expect(collectSignals({ conceptId: "c_12", text: "Can you explain it?" })).toEqual([]);
  });

  it("handles a silence event with no text", () => {
    expect(collectSignals({ conceptId: "c_12", silence: true })).toEqual(["silence"]);
  });
});

describe("updateConceptScore", () => {
  it("adds the turn's signals to the previous score", () => {
    const result = updateConceptScore(0.3, { conceptId: "c_14", text: "I don't know" });
    expect(result).toEqual({ score: 0.75, previous: 0.3, applied: ["dontKnow"], reset: false });
  });

  it("resets to 0 on success and ignores the turn's other signals", () => {
    const result = updateConceptScore(0.55, {
      conceptId: "c_14",
      text: "Um, I think, maybe, it stops when nothing is left",
      success: true,
    });
    expect(result).toEqual({ score: 0, previous: 0.55, applied: [], reset: true });
  });

  it("keeps the score at 1 once capped", () => {
    expect(
      updateConceptScore(0.9, { conceptId: "c_14", text: "no idea", wrongTrace: true }).score,
    ).toBe(1);
  });

  it("changes when the config changes, not the logic", () => {
    const gentle = {
      ...DUCK,
      weights: { ...DUCK.weights, dontKnow: 0.2 },
    };
    expect(updateConceptScore(0, { conceptId: "c", text: "no idea" }, gentle).score).toBe(0.2);
  });
});

// The spec's worked example: sorted input = c_12, when it stops = c_14, update step = c_15.
describe("worked example (binary search)", () => {
  it("turn 2: sorted input is missed once the explanation turn ends -> 0.3", () => {
    const result = updateConceptScore(0, {
      conceptId: "c_12",
      text: "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.",
      explanationTurnEnded: true,
      judge: { ...emptyJudge, missed: [{ conceptId: "c_12" }] },
    });
    expect(result.applied).toEqual(["conceptMissed"]);
    expect(result.score).toBe(0.3);
  });

  it("turn 3: a correct unaided answer resets sorted input; 0.3 is not earned", () => {
    const result = updateConceptScore(0.3, {
      conceptId: "c_12",
      text: "No, they have to be sorted, or you could throw away the half with the target.",
      success: true,
    });
    expect(result.score).toBe(0);
    expect(result.previous).toBeLessThan(DUCK.earnedScore);
  });

  it("turn 4: wrong trace + hedging", () => {
    const result = updateConceptScore(0, {
      conceptId: "c_14",
      text: "Um, I think 5, then 7, then maybe 9?",
      wrongTrace: true,
    });
    // "Um" is 1 filler in 9 words, which is not more than 1 per 8 words,
    // so fillers do not fire. The spec's worked example says 0.45 for this reason.
    expect(result.applied).toEqual(["wrongTrace", "hedging"]);
    expect(result.score).toBe(0.45);
  });

  it("turn 5: correct answer resets; the struggle before it was earned", () => {
    const result = updateConceptScore(0.45, {
      conceptId: "c_14",
      text: "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.",
      success: true,
    });
    expect(result.score).toBe(0);
    expect(result.previous).toBeGreaterThanOrEqual(DUCK.earnedScore);
  });

  it("turn 7: misconception on the update step -> 0.3", () => {
    const text = "I think that's fine?";
    const result = updateConceptScore(0, {
      conceptId: "c_15",
      text,
      judge: {
        ...emptyJudge,
        misconceptions: [{ conceptId: "c_15", quote: "I think that's fine?" }],
      },
    });
    expect(result.applied).toEqual(["misconception"]);
    expect(result.score).toBe(0.3);
  });

  it("turn 8: unaided fix resets the update step; 0.3 is not earned", () => {
    const result = updateConceptScore(0.3, {
      conceptId: "c_15",
      text: "It stays the same… so it loops forever.",
      success: true,
    });
    expect(result.score).toBe(0);
    expect(result.previous).toBeLessThan(DUCK.earnedScore);
  });
});
