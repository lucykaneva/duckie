// Live check: what the duck says when the student asks what it meant, or asks to be explained to.
// RUN_LIVE_JUDGE=1 npx vitest run tests/clarify.live.test.ts --disableConsoleIntercept
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lineProblem, wordMoveDetailed, type WordMoveInput } from "../src/lib/prompts/wordMove";

const live = Boolean(process.env.RUN_LIVE_JUDGE);

function loadKey() {
  const file = path.join(process.cwd(), ".env.local");
  if (process.env.XAI_API_KEY || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq).trim() === "XAI_API_KEY") process.env.XAI_API_KEY = line.slice(eq + 1).trim();
  }
}

const BASE = { conceptName: "Sorted input", topic: "binary search", slide: 4 } as const;

const CASES: Array<{ label: string; input: WordMoveInput; mustNotMatch?: RegExp }> = [
  {
    label: "what do you mean by pebbles (L1)",
    input: {
      ...BASE,
      kind: "rephrase",
      level: "L1",
      studentAsked: "clarify",
      studentWords: "What do you mean by pebbles?",
      lastDuckLine: "So I could use it on my pebbles? They're all mixed up.",
      fallbackLine: "So I could use it on my pebbles? They're all mixed up.",
    },
    mustNotMatch: /^So I could use it on my pebbles\? They're all mixed up\.$/,
  },
  {
    label: "what do you mean (L0, the opening question)",
    input: {
      ...BASE,
      kind: "rephrase",
      level: "L0",
      studentAsked: "clarify",
      studentWords: "What do you mean by update step?",
      lastDuckLine: "My friend wrote lo = mid, not mid + 1. Is that okay?",
      fallbackLine: "My friend wrote lo = mid, not mid + 1. Is that okay?",
    },
  },
  {
    label: "can you explain it (L4)",
    input: {
      ...BASE,
      kind: "question",
      level: "L4",
      studentAsked: "help",
      studentWords: "No, can you explain it?",
      fallbackLine: "It stops when nothing is left to check. Can you say that in your words?",
    },
    mustNotMatch: /can you explain/i,
  },
  {
    label: "can you explain that (L3 hint)",
    input: {
      ...BASE,
      kind: "question",
      level: "L3",
      studentAsked: "help",
      studentWords: "I am not sure. Can you explain that?",
      fallbackLine: "Try the list 2, 4, looking for 3. When do you stop?",
    },
    mustNotMatch: /can you explain|^no\b/i,
  },
  {
    label: "session: 'Are you stupid?' (open)",
    input: {
      ...BASE,
      kind: "open",
      level: "L0",
      studentWords: "Are you stupid?",
      lastDuckLine: "Ooh! Can you explain it to me? I'm just a duck.",
      fallbackLine: "Ooh! Can you explain it to me? I'm just a duck.",
    },
    mustNotMatch: /stupid/i,
  },
  {
    label: "session: not sure what sorted input is (open)",
    input: {
      ...BASE,
      kind: "open",
      level: "L0",
      studentAsked: "clarify",
      studentWords: "I am not sure what a sorted input is. Can you explain?",
      lastDuckLine: "Ooh, can you explain sorted input to me?",
      fallbackLine: "Ooh! Can you explain it to me? I'm just a duck.",
    },
    mustNotMatch: /^(?:can you explain|what do you mean)/i,
  },
  {
    label: "session: 'Yeah.' (L1 question)",
    input: {
      ...BASE,
      kind: "question",
      level: "L1",
      studentWords: "Yeah.",
      lastDuckLine: "Oh. So when does it stop then?",
      fallbackLine: "What happens to lo when it's right next to hi?",
    },
    mustNotMatch: /^yeah/i,
  },
  {
    label: "session: wrong trace then open prompt",
    input: {
      ...BASE,
      kind: "open",
      level: "L0",
      studentWords: "Seven and nine. Five seven, five seven.",
      lastDuckLine: "Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?",
      fallbackLine: "What's the next piece of it?",
    },
    mustNotMatch: /oh right|seven and nine/i,
  },
];

describe.skipIf(!live)("clarification and explain requests (live Grok)", () => {
  it("explains instead of echoing the question back", async () => {
    loadKey();
    for (const c of CASES) {
      let result = await wordMoveDetailed(c.input);
      if (result.source === "fallback" && /timed out|reach/i.test(result.problem ?? "")) {
        result = await wordMoveDetailed(c.input);
      }
      console.log(`${c.label.padEnd(44)} ${result.source.padEnd(8)} ${result.line}${result.problem ? `  [${result.problem}]` : ""}`);
      expect(result.source, c.label).toBe("ai");
      expect(lineProblem(result.line, c.input), c.label).toBeNull();
      if (c.mustNotMatch) expect(result.line, c.label).not.toMatch(c.mustNotMatch);
    }
  }, 120_000);
});
