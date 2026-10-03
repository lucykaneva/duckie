// A12 "done when": the duck's wording changes between two profiles. Live check against the real Grok;
// skipped in `npm test`. Run it with:
//   RUN_LIVE_JUDGE=1 npx vitest run tests/wordMove.tone.live.test.ts --disableConsoleIntercept
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

const TONES = {
  none: undefined,
  direct: "Prefers short, direct questions; gets impatient with long ones.",
  warm: "Warms up to encouragement and a bit of humour; tends to doubt himself.",
};

const BASE = { conceptName: "Sorted input", topic: "binary search" } as const;

const MOVES: Array<{ label: string; input: Omit<WordMoveInput, "toneHint"> }> = [
  {
    label: "wrong answer, hint",
    input: {
      ...BASE,
      kind: "question",
      level: "L1",
      studentWas: "wrong",
      studentWords: "I think binary search works fine on any list, even a messy one.",
      fallbackLine: "What happens to lo when it's next to hi?",
    },
  },
  {
    label: "right answer, restate",
    input: {
      ...BASE,
      kind: "reinforce",
      level: "L1",
      studentWords: "They have to be sorted, or you could throw away the half with the target.",
      fallbackLine: "Got it. Can you say that once more in your own words?",
    },
  },
  {
    label: "wrap-up",
    input: {
      ...BASE,
      kind: "wrap_up",
      level: "L0",
      studentWords: "it halves the list each time",
      fallbackLine: "You explained halving well. Revisit the update step.",
      situation: "Session ended. Strongest: halving the search range. One idea to revisit: the update step.",
    },
  },
];

describe.skipIf(!live)("the profile's tone changes the duck's wording (live Grok)", () => {
  it("writes different lines for different tones, all inside the rules", async () => {
    loadKey();
    for (const move of MOVES) {
      const lines: Record<string, string> = {};
      for (const [name, tone] of Object.entries(TONES)) {
        let result = await wordMoveDetailed({ ...move.input, toneHint: tone });
        // The network is part of the test: one timeout is retried, a real rule problem is not.
        if (result.source === "fallback" && /timed out|reach/i.test(result.problem ?? "")) {
          result = await wordMoveDetailed({ ...move.input, toneHint: tone });
        }
        lines[name] = result.line;
        console.log(`${move.label.padEnd(22)} ${name.padEnd(7)} ${result.source.padEnd(8)} ${result.line}${result.problem ? `   [${result.problem}]` : ""}`);
        expect(result.source, `${move.label} / ${name}`).toBe("ai");
        expect(lineProblem(result.line, move.input), `${move.label} / ${name}`).toBeNull();
      }
      expect(new Set(Object.values(lines)).size, `${move.label} should differ between tones`).toBeGreaterThan(1);
    }
  }, 120_000);
});
