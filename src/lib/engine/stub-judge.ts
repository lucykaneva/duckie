import type { JudgeResult } from "../duck/types";

/**
 * A judge result that finds nothing. This is what a turn is evaluated with when judgeTurn is not used:
 * it timed out or failed (code-only signals), or the turn is one the engine handles without scoring.
 */
export function emptyJudgeResult(): JudgeResult {
  return { covered: [], missed: [], misconceptions: [], contradictions: [], vague: [] };
}
