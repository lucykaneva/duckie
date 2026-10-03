import type { SessionResults } from "@/lib/duck/types";

/** Rich Binary search debrief used by ?mock=1 and when the results request fails. */
export const MOCK_RESULTS: SessionResults = {
  sessionId: "s_mock",
  topic: "Binary search",
  confidence: 4,
  understanding: 30,
  illusionScore: 50,
  strongestMoment: "You found that it only works when the list is in order.",
  reviseNext: "The update step",
  concepts: [
    {
      id: "c_12",
      name: "Sorted input",
      state: "assisted",
      levelReached: "L1",
      slide: 4,
      quotes: ["No, they have to be sorted first."],
    },
    {
      id: "c_13",
      name: "Halving",
      state: "owned",
      levelReached: "L0",
      slide: 5,
      quotes: ["Each check throws away half the list."],
    },
    {
      id: "c_14",
      name: "When it stops",
      state: "misconception",
      levelReached: "L2",
      slide: 6,
      quotes: ["It just stops when the number isn't there, right?"],
    },
    {
      id: "c_15",
      name: "The update step",
      state: "explained_to",
      levelReached: "L4",
      slide: 7,
      quotes: ["I think that's fine? You just move the middle."],
    },
    {
      id: "c_16",
      name: "O(log n)",
      state: "skipped",
      levelReached: "L0",
      slide: 9,
      quotes: ["Can we skip the big O bit?"],
    },
  ],
  duckLearned: [
    'You skip the update step unless asked (turn 7: "I think that\'s fine?")',
  ],
  recall: [
    { conceptId: "c_14", due: "2026-10-05" },
    { conceptId: "c_15", due: "2026-10-05" },
    { conceptId: "c_16", due: "2026-10-05" },
  ],
};
