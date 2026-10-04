// B5 demo seed: binary search, taken from the worked example in the rules spec.
// Ids match the API stubs (course_1, sec_1, c_12 = "Sorted input").
// Slide numbers 4 and 7 come from the spec; the others are placeholders until
// the real deck is uploaded. Fallback lines are drafts: each is 20 words or
// fewer with at most one question. L1 to L3 never state an answer and never
// mention a slide. L4 is the short explanation plus teach-back question.

export interface SeedConcept {
  id: string;
  topic: string;
  name: string;
  slide: number;
  kind: "explain" | "trace" | "predict";
  misconceptions: string[];
  checkPrompt: string;
  /** The check question states a wrong claim for the student to catch (B9). */
  plantsMisconception?: boolean;
  fallbackQuestions: { L1: string; L2: string; L3: string; L4: string };
  /** Server only. Goes to concept_secrets, never to an API response. */
  secret?: { referenceCode: string; expectedAnswer: string };
}

export const SEED_USER = { id: "u_demo", name: "Demo student" };
export const SEED_COURSE = { id: "course_1", userId: "u_demo", name: "Algorithms" };
export const SEED_SECTION = {
  id: "sec_1",
  courseId: "course_1",
  name: "Binary search",
  type: "test" as const,
};

// Returns the values the search checks, in order. Spec: list 1, 3, 5, 7, 9,
// target 6, mid = floor((lo + hi) / 2) checks 5, then 7, then stops.
export const TRACE_REFERENCE_CODE = `
const list = [1, 3, 5, 7, 9];
const target = 6;
let lo = 0;
let hi = list.length - 1;
const checked = [];
while (lo <= hi) {
  const mid = Math.floor((lo + hi) / 2);
  checked.push(list[mid]);
  if (list[mid] === target) break;
  if (list[mid] < target) lo = mid + 1;
  else hi = mid - 1;
}
return checked;
`.trim();

export const SEED_CONCEPTS: SeedConcept[] = [
  {
    id: "c_12",
    topic: "Binary search",
    name: "Sorted input",
    slide: 4,
    kind: "explain",
    misconceptions: ["Binary search works on any list"],
    checkPrompt: "Does binary search work on any list?",
    fallbackQuestions: {
      L1: "So I could use it on my pebbles? They're all mixed up.",
      L2: "Hmm, does the order of the things matter?",
      L3: "Try it with 9, 2, 5, looking for 2. Does halving still make sense?",
      L4: "It only works on sorted lists, so halving can safely drop one side. Can you say why?",
    },
  },
  {
    id: "c_13",
    topic: "Binary search",
    name: "Halving",
    slide: 5,
    kind: "explain",
    misconceptions: [],
    checkPrompt: "How does it find things so fast?",
    fallbackQuestions: {
      L1: "Why not just check every item one by one?",
      L2: "What happens to the list each time you check?",
      L3: "Say there are 8 items. How many are left after one check?",
      L4: "Each check throws away half the list. Can you say that back in your words?",
    },
  },
  {
    id: "c_14",
    topic: "Binary search",
    name: "When it stops",
    slide: 7,
    kind: "trace",
    misconceptions: [],
    checkPrompt: "Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?",
    fallbackQuestions: {
      L1: "What if the thing I want isn't in the list at all?",
      L2: "What has to be true before you stop looking?",
      L3: "Try the list 2, 4 looking for 3. When do you stop?",
      L4: "It stops when nothing is left to search, or it finds the target. Can you say that back?",
    },
    secret: { referenceCode: TRACE_REFERENCE_CODE, expectedAnswer: "[5,7]" },
  },
  {
    id: "c_15",
    topic: "Binary search",
    name: "The update step",
    slide: 9,
    kind: "explain",
    misconceptions: ["lo = mid is fine"],
    checkPrompt: "My friend wrote lo = mid, not mid + 1. Is that okay?",
    plantsMisconception: true,
    fallbackQuestions: {
      L1: "What happens to lo when it's right next to hi?",
      L2: "When you move lo, what do you set it to?",
      L3: "Try lo = 3 and hi = 4. What happens if lo = mid?",
      L4: "lo has to become mid + 1, or it can loop forever. Can you say why?",
    },
  },
  {
    id: "c_16",
    topic: "Binary search",
    name: "O(log n)",
    slide: 11,
    kind: "explain",
    misconceptions: [],
    checkPrompt: "How many checks for a million items?",
    fallbackQuestions: {
      L1: "Is it much faster than going one by one?",
      L2: "How does the number of checks grow when the list gets huge?",
      L3: "Say 8 items. How many times can you halve it before one is left?",
      L4: "Halving means about twenty checks for a million items. Can you say why?",
    },
  },
];
