// Live check of judgeTurn against the real Grok. Skipped in `npm test` (it costs a little and needs the network).
// Run it with:  RUN_LIVE_JUDGE=1 npx vitest run tests/judge.live.test.ts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ConceptForJudge, JudgeResult } from "../src/lib/duck/types";
import { judgeTurn } from "../src/lib/prompts/judgeTurn";
import { findQuote } from "../src/lib/prompts/quotes";

const live = Boolean(process.env.RUN_LIVE_JUDGE);

function loadKey() {
  const file = path.join(process.cwd(), ".env.local");
  if (process.env.XAI_API_KEY || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && line.slice(0, eq).trim() === "XAI_API_KEY") process.env.XAI_API_KEY = line.slice(eq + 1).trim();
  }
}

const CONCEPTS: ConceptForJudge[] = [
  { id: "c_sorted", name: "Sorted input", misconceptions: ["Binary search works on any list"] },
  { id: "c_halving", name: "Halving", misconceptions: [] },
  { id: "c_stops", name: "When it stops", misconceptions: [] },
  { id: "c_update", name: "The update step", misconceptions: ["lo = mid is fine"] },
  { id: "c_log", name: "O(log n)", misconceptions: [] },
];

const ids = (items: { conceptId: string }[]) => items.map((i) => i.conceptId).sort();

async function judge(label: string, text: string, explanationTurnEnded = true, concepts = CONCEPTS) {
  const started = Date.now();
  const result = await judgeTurn({ text, concepts, explanationTurnEnded });
  console.log(`\n--- ${label} (${Date.now() - started} ms)\n"${text}"\n${JSON.stringify(result, null, 1)}`);
  assertQuotesAreVerbatim(text, result);
  return result;
}

/** The rule that matters most: no item may carry words the student did not say. */
function assertQuotesAreVerbatim(text: string, result: JudgeResult) {
  const quotes = [
    ...result.covered.map((i) => i.quote),
    ...result.misconceptions.map((i) => i.quote),
    ...result.vague.map((i) => i.quote),
    ...result.contradictions.flatMap((i) => i.quotes),
  ];
  for (const quote of quotes) expect(findQuote(text, quote)).toBe(quote);
}

describe.skipIf(!live)("judgeTurn against real Grok", () => {
  loadKey();

  it("worked example turn 2: halving covered, sorted input missed", async () => {
    const r = await judge(
      "turn 2",
      "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.",
    );
    expect(ids(r.covered)).toContain("c_halving");
    expect(ids(r.missed)).toContain("c_sorted");
    expect(ids(r.covered)).not.toContain("c_sorted");
  }, 20_000);

  it("worked example turn 3: sorted input covered", async () => {
    const r = await judge(
      "turn 3",
      "No, they have to be sorted, or you could throw away the half with the target.",
      false,
      [CONCEPTS[0]],
    );
    expect(ids(r.covered)).toEqual(["c_sorted"]);
    expect(r.missed).toEqual([]);
  }, 20_000);

  it("worked example turn 7: 'that's fine' about lo = mid is a misconception", async () => {
    const r = await judge("turn 7", "I think that's fine? lo equals mid should work.", false, [CONCEPTS[3]]);
    expect(ids(r.misconceptions)).toEqual(["c_update"]);
  }, 20_000);

  it("a vague answer is flagged vague", async () => {
    const r = await judge("vague", "It just works, it finds the number really fast somehow.", true);
    expect(ids(r.vague).length).toBeGreaterThan(0);
  }, 20_000);

  it("a self-contradiction carries both quotes", async () => {
    const r = await judge(
      "contradiction",
      "When lo and mid are the same it stays the same and that is fine. Then it moves up by one each time. It never moves.",
      false,
      [CONCEPTS[3]],
    );
    // Soft: contradictions are the hardest call, so only require that anything returned is quoted.
    for (const c of r.contradictions) expect(c.quotes).toHaveLength(2);
  }, 20_000);

  it("an off-topic turn finds nothing about the concepts", async () => {
    const r = await judge("off topic", "Um, I had pizza for lunch and my cat is called Biscuit.", false);
    expect(r.covered).toEqual([]);
    expect(r.misconceptions).toEqual([]);
  }, 20_000);
});
