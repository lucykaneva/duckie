import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import type { Profile, TurnLogRow } from "../src/lib/duck/types";
import { levelForScore } from "../src/lib/engine/ladder";
import {
  applyProfileConfig,
  clampToDefault,
  finishProfile,
  keepQuotedLines,
  profileFacts,
  proposedOverrides,
} from "../src/lib/engine/profile";

const skipTurn = (text: string, n = 1): TurnLogRow => ({
  id: `t_${n}`,
  sessionId: "s_test",
  n,
  text,
  startedAt: "",
  endedAt: "",
  signals: [],
  scoreAfter: 0,
  level: "L1",
  moveKind: "offer_skip",
  line: "Want to skip this one?",
});

describe("clamp and apply", () => {
  it("keeps a number inside ±25% of the default", () => {
    expect(clampToDefault(0.9, DUCK.levels.L1)).toBeCloseTo(DUCK.levels.L1 * 1.25);
    expect(clampToDefault(0.01, DUCK.levels.L1)).toBeCloseTo(DUCK.levels.L1 * 0.75);
    expect(clampToDefault(DUCK.levels.L1, DUCK.levels.L1)).toBe(DUCK.levels.L1);
  });

  it("ignores overrides that are not adaptability knobs", () => {
    const next = applyProfileConfig(DUCK, { sessionMaxMs: 1, maxDuckWords: 5 });
    expect(next.sessionMaxMs).toBe(DUCK.sessionMaxMs);
    expect(next.maxDuckWords).toBe(DUCK.maxDuckWords);
  });
});

describe("two users get different thresholds", () => {
  it("a skip-heavy student waits longer on L1 than an overconfident one", () => {
    const naggy = proposedOverrides({
      skipCount: 2,
      unfinishedTurns: 0,
      studentTurns: 4,
      hedgingTurns: 0,
      illusion: 0,
      overconfident: false,
      pausesMidThought: false,
      skipsOften: true,
    });
    const cocky = proposedOverrides({
      skipCount: 0,
      unfinishedTurns: 0,
      studentTurns: 4,
      hedgingTurns: 0,
      illusion: 70,
      overconfident: true,
      pausesMidThought: false,
      skipsOften: false,
    });
    const naggyCfg = applyProfileConfig(DUCK, naggy);
    const cockyCfg = applyProfileConfig(DUCK, cocky);

    expect(naggyCfg.levels.L1).toBeGreaterThan(DUCK.levels.L1);
    expect(cockyCfg.levels.L1).toBeLessThan(DUCK.levels.L1);
    expect(naggyCfg.levels.L1).not.toBe(cockyCfg.levels.L1);

    const score = 0.3;
    expect(levelForScore(score, DUCK)).toBe("L1");
    expect(levelForScore(score, naggyCfg)).toBe("L0");
    expect(levelForScore(score, cockyCfg)).toBe("L1");
  });
});

describe("quote-or-it-does-not-count", () => {
  it("drops a learned line that does not quote the student", () => {
    const kept = keepQuotedLines(
      ['You skip the update step unless asked (turn 7: "I think that\'s fine?")', "You love binary search"],
      ["Yeah I think that's fine?"],
    );
    expect(kept).toEqual(['You skip the update step unless asked (turn 7: "I think that\'s fine?")']);
  });

  it("finishProfile uses the quoted AI line and code-owned overrides", () => {
    const turns = [skipTurn("Yeah I want to skip this one"), skipTurn("Can we skip the log n thing", 2)];
    const facts = profileFacts({
      concepts: [
        { state: "skipped", skipped: true },
        { state: "skipped", skipped: true },
        { state: "owned", skipped: false },
      ],
      turns,
      confidence: 1,
    });
    const drafted: Partial<Profile> = {
      calibration: "AI prose",
      duckLearned: ['You skip when asked ("I want to skip this one")', "Invented with no quote"],
      configOverrides: { levels: { L1: 0.9, L2: 0.45, L3: 0.6, L4: 0.8 } },
    };
    const profile = finishProfile({
      userId: "u_skip",
      turns,
      facts,
      drafted,
    });
    expect(profile.duckLearned.some((line) => line.includes("I want to skip this one"))).toBe(true);
    expect(profile.duckLearned.some((line) => line.includes("Invented"))).toBe(false);
    expect(profile.configOverrides.maxMovesPerConcept).toBe(2);
    expect(profile.configOverrides.levels?.L1).toBeCloseTo(DUCK.levels.L1 * (1 + 0.25));
    expect(profile.calibration).toBe("AI prose");
  });
});
