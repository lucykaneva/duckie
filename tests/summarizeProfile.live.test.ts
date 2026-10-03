// Live check of summarizeProfile against the real Grok. Skipped in `npm test` (it costs a little and needs the network).
// Run it with:  RUN_LIVE_JUDGE=1 npx vitest run tests/summarizeProfile.live.test.ts --disableConsoleIntercept
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TurnLogRow } from "../src/lib/duck/types";
import { findQuote } from "../src/lib/prompts/quotes";
import { summarizeProfileDetailed } from "../src/lib/prompts/summarizeProfile";

const live = Boolean(process.env.RUN_LIVE_JUDGE);

function loadKey() {
  const file = path.join(process.cwd(), ".env.local");
  if (process.env.XAI_API_KEY || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq).trim() === "XAI_API_KEY") process.env.XAI_API_KEY = line.slice(eq + 1).trim();
  }
}

function row(
  n: number,
  text: string,
  wpm: number,
  signals: string[] = [],
  moveKind: TurnLogRow["moveKind"] = "question",
  level: TurnLogRow["level"] = "L1",
): TurnLogRow {
  const words = text.trim().split(/\s+/).length;
  const start = 1_760_000_000_000 + n * 60_000;
  return {
    id: `t${n}`,
    sessionId: "s_1",
    n,
    text,
    startedAt: new Date(start).toISOString(),
    endedAt: new Date(start + (words / wpm) * 60_000).toISOString(),
    signals,
    scoreAfter: 0,
    level,
    moveKind,
    line: "",
  };
}

// Both are a binary search session. The first student rambles, hedges, jokes, and bails; the second is crisp.
const HESITANT: TurnLogRow[] = [
  row(1, "Okay so, um, binary search is like finding a word in a dictionary, haha, you open it in the middle I think", 80, ["hedging", "fillers"]),
  row(2, "Uh, so it works on any list, right? I guess you just keep halving whatever you have", 80, ["hedging", "misconception"], "question", "L2"),
  row(3, "I don't know, honestly I always skip the part about the update step", 80, ["dontKnow"], "offer_skip", "L3"),
  row(4, "Yeah, skip it please", 80, [], "question", "L1"),
  row(5, "Um, lo equals mid? I think that's fine?", 80, ["hedging", "misconception"], "offer_skip", "L2"),
  row(6, "Let's move on, my brain is fried", 80, [], "question", "L0"),
];
const CONFIDENT: TurnLogRow[] = [
  row(1, "Binary search halves a sorted list every step by comparing the target to the middle element", 175, [], "question", "L0"),
  row(2, "If the middle is too small you set lo to mid plus one, otherwise hi becomes mid minus one, or it can loop forever", 175, [], "celebrate", "L0"),
  row(3, "It stops when lo passes hi, and it takes log n steps because each step halves the range", 175, [], "question", "L0"),
];

describe.skipIf(!live)("summarizeProfile (live Grok)", () => {
  for (const [label, turns, sessions] of [
    ["hesitant student", HESITANT, [{ confidence: 5, understanding: 25 }]],
    ["confident student", CONFIDENT, [{ confidence: 4, understanding: 90 }]],
  ] as const) {
    it(label, async () => {
      loadKey();
      const started = Date.now();
      const result = await summarizeProfileDetailed({ turns: [...turns], sessions: [...sessions] });
      console.log(`\n--- ${label} (${Date.now() - started} ms, ${result.source}${result.problem ? `, ${result.problem}` : ""})`);
      console.log(JSON.stringify(result.profile, null, 1));

      expect(result.source).toBe("ai");
      expect(result.profile.duckLearned.length).toBeGreaterThan(0);
      for (const line of result.profile.duckLearned) {
        const [, turn, quote] = line.match(/\(turn (\d+): "(.+)"\)$/) ?? [];
        const source = turns.find((r) => r.n === Number(turn));
        expect(source, line).toBeDefined();
        expect(findQuote(source!.text, quote), line).not.toBeNull();
      }
    }, 30_000);
  }
});
