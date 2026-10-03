import type { DueRecall } from "@/lib/duck/types";
import { isoDay } from "./dates";

/** Used by ?mock=1 and when GET /api/review/due fails. */
export const MOCK_REVIEW_DUE: DueRecall[] = [
  {
    conceptId: "c_11",
    name: "Loop invariant",
    topic: "Binary search",
    due: isoDay(0),
    stateAfter: "owned",
  },
  {
    conceptId: "c_12",
    name: "Sorted input",
    topic: "Binary search",
    due: isoDay(0),
    stateAfter: "assisted",
  },
  {
    conceptId: "c_15",
    name: "The update step",
    topic: "Binary search",
    due: isoDay(0),
    stateAfter: "explained_to",
  },
  {
    conceptId: "c_14",
    name: "When it stops",
    topic: "Binary search",
    due: isoDay(0),
    stateAfter: "misconception",
  },
  {
    conceptId: "c_16",
    name: "Midpoint overflow",
    topic: "Binary search",
    due: isoDay(3),
    stateAfter: "assisted",
  },
];
