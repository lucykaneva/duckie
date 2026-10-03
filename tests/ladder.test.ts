import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import type { Level } from "../src/lib/duck/types";
import {
  chooseLevel,
  levelForScore,
  stateAfterResolve,
  type LevelInput,
} from "../src/lib/engine/ladder";

const base: LevelInput = {
  score: 0,
  lastLevel: "L0",
  failedAttempts: 0,
  failedThisTurn: false,
  misconception: false,
  helpRequested: false,
};
const pick = (overrides: Partial<LevelInput>): Level => chooseLevel({ ...base, ...overrides });

describe("score bands", () => {
  it.each([
    [0, "L0"],
    [0.24, "L0"],
    [DUCK.levels.L1, "L1"],
    [0.44, "L1"],
    [DUCK.levels.L2, "L2"],
    [0.59, "L2"],
    [DUCK.levels.L3, "L3"],
    [0.79, "L3"],
    [DUCK.levels.L4, "L4"],
    [1, "L4"],
  ] as [number, Level][])("score %s is %s", (score, level) => {
    expect(levelForScore(score)).toBe(level);
  });

  it("puts the lower edge of a band in the higher level", () => {
    expect(levelForScore(0.45)).toBe("L2");
  });

  it("reads the cutoffs from the config", () => {
    const strict = { levels: { L1: 0.1, L2: 0.2, L3: 0.3, L4: 0.4 } };
    expect(levelForScore(0.15, strict)).toBe("L1");
    expect(levelForScore(0.4, strict)).toBe("L4");
  });
});

describe("chooseLevel: first help move", () => {
  it("follows the score band", () => {
    expect(pick({ score: 0.1 })).toBe("L0");
    expect(pick({ score: 0.3 })).toBe("L1");
    expect(pick({ score: 0.5 })).toBe("L2");
    expect(pick({ score: 0.7 })).toBe("L3");
  });

  it("starts a misconception at L1 even with a low score", () => {
    expect(pick({ score: 0, misconception: true })).toBe("L1");
    expect(pick({ score: 0.1, misconception: true })).toBe("L1");
  });

  it("is never L4, even at a score of 1: L4 needs an attempt first", () => {
    expect(pick({ score: 1 })).toBe("L3");
    expect(pick({ score: 0.9 })).toBe("L3");
  });
});

describe("chooseLevel: a request for help", () => {
  it("starts at L3, never L4", () => {
    expect(pick({ score: 0, helpRequested: true })).toBe("L3");
    expect(pick({ score: 0.3, helpRequested: true })).toBe("L3");
    expect(pick({ score: 1, helpRequested: true })).toBe("L3");
  });

  it("jumps from a lower level to L3", () => {
    expect(pick({ score: 0.3, lastLevel: "L1", helpRequested: true })).toBe("L3");
  });

  it("does not hold the duck at L3 once it is already there", () => {
    expect(
      pick({ score: 0.7, lastLevel: "L3", failedAttempts: 3, failedThisTurn: true, helpRequested: true }),
    ).toBe("L4");
  });
});

describe("chooseLevel: climbing", () => {
  it("climbs one level per failed attempt", () => {
    expect(pick({ score: 0.3, lastLevel: "L1", failedAttempts: 1, failedThisTurn: true })).toBe("L2");
    expect(pick({ score: 0.3, lastLevel: "L2", failedAttempts: 2, failedThisTurn: true })).toBe("L3");
  });

  it("never jumps more than one step above the last level", () => {
    expect(pick({ score: 0.9, lastLevel: "L1" })).toBe("L2");
    expect(pick({ score: 0.9, lastLevel: "L2" })).toBe("L3");
  });

  it("never drops below the last level", () => {
    expect(pick({ score: 0.1, lastLevel: "L3" })).toBe("L3");
    expect(pick({ score: 0, lastLevel: "L2" })).toBe("L2");
  });

  it("reaches L4 after 3 failed attempts", () => {
    expect(pick({ score: 0.3, lastLevel: "L3", failedAttempts: 3, failedThisTurn: true })).toBe("L4");
  });

  it("reaches L4 at the top score band after an attempt", () => {
    expect(pick({ score: 0.85, lastLevel: "L3", failedAttempts: 1, failedThisTurn: true })).toBe("L4");
  });

  it("holds at L3 when L4 is not earned yet", () => {
    expect(pick({ score: 0.3, lastLevel: "L3", failedAttempts: 1, failedThisTurn: true })).toBe("L3");
    expect(pick({ score: 0.3, lastLevel: "L3", failedAttempts: 2, failedThisTurn: true })).toBe("L3");
  });

  it("stays at L4 once there", () => {
    expect(pick({ score: 0.1, lastLevel: "L4", failedAttempts: 4, failedThisTurn: true })).toBe("L4");
  });

  it("reads the failed-attempt limit from the config", () => {
    const quick = { levels: DUCK.levels, failedAttemptsForL4: 1 };
    expect(
      chooseLevel(
        { ...base, score: 0.3, lastLevel: "L3", failedAttempts: 1, failedThisTurn: true },
        quick,
      ),
    ).toBe("L4");
  });
});

describe("how a concept ends", () => {
  it("is Owned with no help, Assisted after L1 to L3, Explained to after L4", () => {
    expect(stateAfterResolve("L0")).toBe("owned");
    expect(stateAfterResolve("L1")).toBe("assisted");
    expect(stateAfterResolve("L2")).toBe("assisted");
    expect(stateAfterResolve("L3")).toBe("assisted");
    expect(stateAfterResolve("L4")).toBe("explained_to");
  });
});
