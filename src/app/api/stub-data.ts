import type {
  Concept,
  Course,
  DuckMove,
  DueRecall,
  Profile,
  Section,
  SessionResults,
} from "@/lib/duck/types";
import { DEMO_USER_ID } from "@/lib/duck/types";

export const STUB_COURSE: Course = {
  id: "course_1",
  userId: DEMO_USER_ID,
  name: "Algorithms",
};

export const STUB_SECTION: Section = {
  id: "sec_1",
  courseId: STUB_COURSE.id,
  name: "Binary search",
  type: "test",
};

export const STUB_CONCEPT: Concept = {
  id: "c_12",
  topic: "Binary search",
  name: "Sorted input",
  slide: 4,
  kind: "explain",
  misconceptions: ["Binary search works on any list"],
};

export const STUB_MOVE: DuckMove = {
  kind: "question",
  level: "L1",
  conceptId: STUB_CONCEPT.id,
  line: "So I could use it on my pebbles? They're all mixed up.",
  sessionState: "active",
  concepts: [{ id: STUB_CONCEPT.id, state: "not_yet", score: 0.3 }],
};

export const STUB_OPENING_MOVE: DuckMove = {
  kind: "open",
  level: "L0",
  conceptId: STUB_CONCEPT.id,
  line: "I don't really get binary search yet. How does it work?",
  sessionState: "active",
  concepts: [{ id: STUB_CONCEPT.id, state: "not_yet", score: 0 }],
};

export const STUB_RESULTS: SessionResults = {
  sessionId: "s_88",
  topic: "Binary search",
  confidence: 5,
  understanding: 30,
  illusionScore: 70,
  strongestMoment: "Your best bit was when it stops.",
  reviseNext: "The update step",
  concepts: [
    {
      id: "c_12",
      name: "Sorted input",
      state: "assisted",
      levelReached: "L1",
      slide: 4,
      quotes: ["No, they have to be sorted"],
    },
  ],
  duckLearned: [
    'You skip the update step unless asked (turn 7: "I think that\'s fine?")',
  ],
  recall: [{ conceptId: "c_12", due: "2026-10-05" }],
};

export const STUB_PROFILE: Profile = {
  userId: DEMO_USER_ID,
  calibration: "Often feels more sure than the owned share.",
  pace: "Pauses mid-thought; wait a beat longer.",
  nagginess: "Skips when pressed; fewer follow-ups.",
  teachingHabits: ["skips the update step unless asked"],
  tone: "Responds to humour.",
  configOverrides: {},
  duckLearned: STUB_RESULTS.duckLearned,
  updatedAt: "2026-10-03T13:00:00.000Z",
};

export const STUB_DUE: DueRecall[] = [
  {
    conceptId: "c_12",
    name: "Sorted input",
    topic: "Binary search",
    due: "2026-10-05",
    stateAfter: "assisted",
  },
];

export const STUB_WRAP_UP: DuckMove = {
  kind: "wrap_up",
  level: "L0",
  conceptId: STUB_CONCEPT.id,
  line: "Your best bit was when it stops. Next time we can try the update step.",
  sessionState: "wrapping_up",
  concepts: [{ id: STUB_CONCEPT.id, state: "assisted", score: 0 }],
};
