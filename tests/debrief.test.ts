import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { DUCK } from "../src/lib/duck/config";
import {
  addUtcDays,
  buildDebrief,
  firstRecallDays,
  illusionScore,
  pickRevise,
  pickStrongest,
  planRecall,
  understandingPercent,
  wrapSummaryLine,
} from "../src/lib/engine/debrief";
import type { ConceptDef, ConceptRun } from "../src/lib/engine/turn";

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

function run(partial: Partial<ConceptRun> & { conceptId: string }): ConceptRun {
  return {
    state: "not_yet",
    score: 0,
    levelReached: "L0",
    moves: 0,
    failedAttempts: 0,
    skipped: false,
    celebrated: false,
    ...partial,
  };
}

describe("understanding and illusion", () => {
  it("counts owned as 1 and assisted as half", () => {
    expect(
      understandingPercent([
        { state: "owned" },
        { state: "assisted" },
        { state: "not_yet" },
        { state: "skipped" },
        { state: "misconception" },
      ]),
    ).toBe(30);
  });

  it("is felt minus understanding (the plan's 5/5 and 30% example)", () => {
    expect(illusionScore(5, 30)).toBe(70);
    expect(illusionScore(4, 30)).toBe(50);
    expect(illusionScore(1, 80)).toBe(-60);
  });
});

describe("what to celebrate and what to revisit", () => {
  it("prefers a celebrated concept as the strongest moment", () => {
    const concepts = [
      run({ conceptId: "c_12", state: "owned" }),
      run({ conceptId: "c_15", state: "assisted", celebrated: true }),
    ];
    expect(pickStrongest(concepts)?.conceptId).toBe("c_15");
  });

  it("does not call a not-yet concept a find", () => {
    expect(pickStrongest([run({ conceptId: "c_12", state: "not_yet" })])).toBeUndefined();
  });

  it("revisits the worst hole, and nothing when everything is owned", () => {
    expect(
      pickRevise([
        run({ conceptId: "c_12", state: "owned" }),
        run({ conceptId: "c_15", state: "misconception" }),
        run({ conceptId: "c_16", state: "skipped" }),
      ])?.conceptId,
    ).toBe("c_15");
    expect(pickRevise([run({ conceptId: "c_12", state: "owned" })])).toBeUndefined();
  });
});

describe("recall intervals", () => {
  it("starts at 1, 2 or 4 days from the ending state", () => {
    expect(firstRecallDays("misconception")).toBe(1);
    expect(firstRecallDays("explained_to")).toBe(1);
    expect(firstRecallDays("skipped")).toBe(1);
    expect(firstRecallDays("not_yet")).toBe(1);
    expect(firstRecallDays("assisted")).toBe(2);
    expect(firstRecallDays("owned")).toBe(4);
  });

  it("writes the first due date from today", () => {
    const plan = planRecall("c_12", "owned", undefined, "2026-10-03");
    expect(plan).toMatchObject({ intervalDays: 4, successes: 0, due: "2026-10-07" });
  });

  it("doubles after a successful later recall, and resets to 1 day after a miss", () => {
    const existing = { conceptId: "c_12", stateAfter: "owned" as const, intervalDays: 4, successes: 0 };
    expect(planRecall("c_12", "owned", existing, "2026-10-03")).toMatchObject({
      intervalDays: 8,
      successes: 1,
      due: "2026-10-11",
    });
    expect(planRecall("c_12", "misconception", existing, "2026-10-03")).toMatchObject({
      intervalDays: 1,
      successes: 0,
      due: "2026-10-04",
    });
  });

  it("does not pass the 30 day cap", () => {
    const existing = { conceptId: "c_12", stateAfter: "owned" as const, intervalDays: 16, successes: 2 };
    expect(planRecall("c_12", "owned", existing, "2026-10-03").intervalDays).toBe(DUCK.recallMaxDays);
    expect(addUtcDays("2026-10-03", 30)).toBe("2026-11-02");
  });
});

describe("the wrap-up line and the results shape", () => {
  it("fits in 20 words and names the hole", () => {
    const line = wrapSummaryLine("You found when it stops.", "The update step");
    expect(line).toBe("You found when it stops. Revisit the update step.");
    expect(line.split(/\s+/).length).toBeLessThanOrEqual(20);
  });

  it("builds the API results from the session, not a stub", () => {
    const { results, wrapLine, situation, recall } = buildDebrief({
      sessionId: "s_88",
      topic: "Binary search",
      confidence: 5,
      defs,
      today: "2026-10-03",
      celebrationLine: "Ooh you caught the mistake in the update step.",
      quotes: [{ conceptId: "c_12", text: "they have to be sorted" }],
      concepts: [
        run({ conceptId: "c_12", state: "assisted", levelReached: "L1", moves: 2 }),
        run({ conceptId: "c_13", state: "owned", moves: 1 }),
        run({ conceptId: "c_14", state: "owned", moves: 1 }),
        run({ conceptId: "c_15", state: "owned", celebrated: true, moves: 1 }),
        run({ conceptId: "c_16", state: "not_yet" }),
      ],
    });

    expect(results.understanding).toBe(70);
    expect(results.illusionScore).toBe(30);
    expect(results.strongestMoment).toBe("Ooh you caught the mistake in the update step.");
    expect(results.reviseNext).toBe("O(log n)");
    expect(results.concepts.find((c) => c.id === "c_12")?.quotes).toEqual(["they have to be sorted"]);
    expect(wrapLine).toMatch(/O\(log n\)|log/i);
    expect(situation).toMatch(/Illusion score 30/);
    expect(recall.find((r) => r.conceptId === "c_15")?.due).toBe("2026-10-07");
    expect(recall.find((r) => r.conceptId === "c_16")?.due).toBe("2026-10-04");
  });

  it("does not claim they found a concept they never taught", () => {
    const { results, wrapLine } = buildDebrief({
      sessionId: "s_88",
      topic: "Binary search",
      confidence: 3,
      defs,
      today: "2026-10-03",
      concepts: defs.map((d) => run({ conceptId: d.id, state: "not_yet" })),
    });
    expect(results.strongestMoment).toBe("We didn't get far.");
    expect(results.reviseNext).toBe("Sorted input");
    expect(wrapLine).not.toMatch(/found/i);
  });

  it("does not double recall dates when reading results after /end", () => {
    const concepts = [run({ conceptId: "c_12", state: "owned" })];
    const stored = [{ conceptId: "c_12", stateAfter: "owned" as const, intervalDays: 4, successes: 0, due: "2026-10-07" }];
    const again = buildDebrief({
      sessionId: "s_88",
      topic: "Binary search",
      confidence: 4,
      defs,
      concepts,
      existingRecall: stored,
      freezeRecall: true,
      today: "2026-10-03",
    });
    expect(again.recall[0]).toMatchObject({ due: "2026-10-07", intervalDays: 4 });
  });
});
