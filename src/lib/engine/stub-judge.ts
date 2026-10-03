import type { JudgeResult } from "../duck/types";

/**
 * B7 placeholder for Dev A's judgeTurn: finds nothing.
 * Replaced in B11 once judgeTurn is wired into /turn.
 */
export function emptyJudgeResult(): JudgeResult {
  return { covered: [], missed: [], misconceptions: [], contradictions: [], vague: [] };
}
