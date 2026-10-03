import type { DuckInsight, Profile } from "@/lib/duck/types";
import { DEMO_USER_ID } from "@/lib/duck/types";

export const MOCK_INSIGHTS: DuckInsight[] = [
  {
    id: "ins_update",
    valence: "watch_out",
    noticed: "You skip the update step unless asked.",
    duckPrompt: "What happens to lo after you check the middle?",
    quote: "I think that's fine?",
    topic: "Binary search",
    date: "2026-10-03",
    turn: 7,
    sessionId: "s_demo",
    adaptation: "I'll ask about the update step earlier.",
    isNew: true,
  },
  {
    id: "ins_pause",
    valence: "watch_out",
    noticed: "You pause mid-thought.",
    evidenceText: "Paused 4 s after 'and' in 3 of 5 turns",
    topic: "Binary search",
    date: "2026-10-01",
    turn: 4,
    sessionId: "s_demo",
    adaptation: "I'll wait longer before speaking.",
  },
  {
    id: "ins_example",
    valence: "strength",
    noticed: "You reach for a smaller example when stuck.",
    quote: "Can we try it with just four numbers?",
    topic: "Binary search",
    date: "2026-09-28",
    turn: 11,
    sessionId: "s_mock",
    adaptation: "I'll offer small cases sooner when you're stuck.",
  },
  {
    id: "ins_sorted",
    valence: "strength",
    noticed: "You name the sorted requirement unprompted.",
    quote: "No, they have to be sorted first.",
    topic: "Binary search",
    date: "2026-09-22",
    turn: 2,
    sessionId: "s_mock",
    adaptation: "I'll let you name the precondition before I ask.",
  },
];

/** Used by GET /api/profile?mock=1 and when the live profile request fails. */
export const MOCK_PROFILE: Profile = {
  userId: DEMO_USER_ID,
  calibration:
    "You usually feel 4–5/5 and own about half. Duckie will check your confident topics sooner.",
  pace: "Pauses mid-thought; wait a beat longer.",
  nagginess: "Skips when pressed; fewer follow-ups.",
  teachingHabits: [
    "skips the update step unless asked",
    "pauses mid-thought",
    "reaches for a smaller example when stuck",
  ],
  tone: "Responds to humour.",
  configOverrides: {},
  duckLearned: [
    'You skip the update step unless asked (turn 7: "I think that\'s fine?")',
    'You pause mid-thought (turn 4: evidence)',
    'You reach for a smaller example when stuck (turn 11: "Can we try it with just four numbers?")',
    'You name the sorted requirement unprompted (turn 2: "No, they have to be sorted first.")',
  ],
  insights: MOCK_INSIGHTS,
  sessionCount: 4,
  updatedAt: "2026-10-03T13:00:00.000Z",
};
