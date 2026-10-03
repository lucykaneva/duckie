import { DUCK } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type { ConceptState, Level } from "../duck/types";

const LEVELS: Level[] = ["L0", "L1", "L2", "L3", "L4"];

/** Only the config values the ladder reads (so per-user overrides can be passed in). */
export type LadderConfig = Pick<DuckConfig, "levels" | "failedAttemptsForL4">;

export function levelRank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function stepUp(level: Level): Level {
  return LEVELS[Math.min(levelRank(level) + 1, LEVELS.length - 1)];
}

export function higherLevel(a: Level, b: Level): Level {
  return levelRank(a) >= levelRank(b) ? a : b;
}

export function lowerLevel(a: Level, b: Level): Level {
  return levelRank(a) <= levelRank(b) ? a : b;
}

/** Score band to level. The lower edge of a band belongs to the higher level (0.45 is L2). */
export function levelForScore(score: number, config: Pick<DuckConfig, "levels"> = DUCK): Level {
  if (score >= config.levels.L4) return "L4";
  if (score >= config.levels.L3) return "L3";
  if (score >= config.levels.L2) return "L2";
  if (score >= config.levels.L1) return "L1";
  return "L0";
}

export interface LevelInput {
  /** The concept's struggle score after this turn. */
  score: number;
  /** Level of the duck's last help move on this concept; L0 if it has not helped yet. */
  lastLevel: Level;
  failedAttempts: number;
  /** The student just answered after the duck engaged this concept and did not resolve it. */
  failedThisTurn: boolean;
  /** The student stated a wrong belief and has not resolved it. */
  misconception: boolean;
  /** The student asked the duck for help. */
  helpRequested: boolean;
}

/**
 * Which level the duck uses next on a concept.
 *
 * - The score band sets the level (misconceptions start at L1).
 * - A request for help starts at L3, never L4.
 * - Help only climbs: never below the last level, and at most one step above it.
 *   The first help move on a concept is at most L3, since L4 needs an attempt first.
 * - Each failed attempt after a help move climbs one level.
 * - L4 only at the top score band or after enough failed attempts.
 */
export function chooseLevel(input: LevelInput, config: LadderConfig = DUCK): Level {
  const { lastLevel } = input;
  let band = levelForScore(input.score, config);
  if (input.misconception && levelRank(band) < levelRank("L1")) band = "L1";

  if (input.helpRequested && levelRank(lastLevel) < levelRank("L3")) return "L3";

  const cap = lastLevel === "L0" ? "L3" : stepUp(lastLevel);
  let level = lowerLevel(band, cap);
  if (input.failedThisTurn && lastLevel !== "L0") level = stepUp(lastLevel);
  level = higherLevel(level, lastLevel);

  const l4Allowed = band === "L4" || input.failedAttempts >= config.failedAttemptsForL4;
  if (level === "L4" && lastLevel !== "L4" && !l4Allowed) level = "L3";
  return level;
}

/** How a concept ends once the student gets it, from the highest level the duck used. */
export function stateAfterResolve(levelReached: Level): ConceptState {
  if (levelReached === "L0") return "owned";
  if (levelReached === "L4") return "explained_to";
  return "assisted";
}
