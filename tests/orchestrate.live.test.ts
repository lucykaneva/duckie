// Live check of B11 against the real Grok. Skipped in `npm test`.
// Run it with:  RUN_LIVE_JUDGE=1 npx vitest run tests/orchestrate.live.test.ts --disableConsoleIntercept
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { findLeak } from "../src/lib/engine/answers";
import { needsJudge, orchestrateTurn } from "../src/lib/engine/orchestrate";
import type { OrchestrateDeps } from "../src/lib/engine/orchestrate";
import { freshSession, type ConceptDef } from "../src/lib/engine/turn";
import { wordCount } from "../src/lib/engine/wording";
import { judgeTurn } from "../src/lib/prompts/judgeTurn";
import { wordMoveDetailed } from "../src/lib/prompts/wordMove";

const live = Boolean(process.env.RUN_LIVE_JUDGE);

function loadKey() {
  if (process.env.XAI_API_KEY) return;
  for (const name of [".env", ".env.local"]) {
    const file = path.join(process.cwd(), name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0 && line.slice(0, eq).trim() === "XAI_API_KEY") {
        const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (value) process.env.XAI_API_KEY = value;
        return;
      }
    }
  }
}

const defs: ConceptDef[] = SEED_CONCEPTS.map((c) => ({
  id: c.id,
  topic: c.topic,
  name: c.name,
  slide: c.slide,
  kind: c.kind,
  misconceptions: c.misconceptions,
  checkPrompt: c.checkPrompt,
  plantsMisconception: c.plantsMisconception,
  fallbackQuestions: c.fallbackQuestions,
}));

const answers = [{ conceptId: "c_14", expectedAnswer: "[5,7]" }];
const secrets = answers.map((a) => ({
  expectedAnswer: a.expectedAnswer,
  givenText: defs.find((d) => d.id === a.conceptId)?.checkPrompt ?? undefined,
}));

const liveDeps: OrchestrateDeps = {
  judge: (input) => judgeTurn(input),
  word: (input) => wordMoveDetailed(input),
};

const TURNS = [
  "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.",
  "No, they have to be sorted, or you could throw away the half with the target.",
  "Um, I think 5, then 7, then maybe 9?",
  "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.",
  "I think that's fine?",
  "It stays the same… so it loops forever.",
  "About twenty.",
];

describe.skipIf(!live)("worked example against real Grok", () => {
  loadKey();

  it("runs every turn through judgeTurn and wordMove", async () => {
    expect(process.env.XAI_API_KEY, "XAI_API_KEY is not set in .env or .env.local").toBeTruthy();

    let run = freshSession(defs);
    const log: { kind: string; level: string; conceptId: string; line: string }[] = [];

    for (const text of TURNS) {
      const started = Date.now();
      const { outcome, meta } = await orchestrateTurn(
        { defs, run, answers, text, nowMs: run.turnCount * 30_000 },
        liveDeps,
      );
      console.log(
        `\n--- turn ${run.turnCount + 1} (${Date.now() - started} ms) judge=${meta.judge} words=${JSON.stringify(meta.words)}\n"${text}"\n${outcome.move.kind} ${outcome.move.level} ${outcome.move.conceptId}: ${outcome.move.line}`,
      );
      if (needsJudge(run, text)) expect(["ok", "timeout", "http", "error"]).toContain(meta.judge);
      else expect(meta.judge).toBe("skipped");
      expect(wordCount(outcome.move.line)).toBeLessThanOrEqual(DUCK.maxDuckWords);
      expect((outcome.move.line.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
      if (!run.committed.includes("c_14")) {
        expect(findLeak(outcome.move.line, secrets)).toBeNull();
        if (outcome.move.then) expect(findLeak(outcome.move.then.line, secrets)).toBeNull();
      }
      log.push({
        kind: outcome.move.kind,
        level: outcome.move.level,
        conceptId: outcome.move.conceptId,
        line: outcome.move.line,
      });
      if (outcome.move.then) {
        log.push({
          kind: outcome.move.then.kind,
          level: outcome.move.then.level,
          conceptId: outcome.move.then.conceptId,
          line: outcome.move.then.line,
        });
      }
      run = outcome.session;
    }

    // The first four turns are the ones the spec pins down. Later turns depend on Grok
    // catching the planted "lo = mid" misconception, which the live judge sometimes misses.
    expect(log[0]).toMatchObject({ kind: "question", level: "L1", conceptId: "c_12" });
    expect(log[1]).toMatchObject({ kind: "question", level: "L0", conceptId: "c_14" });
    expect(log[2]).toMatchObject({ kind: "question", level: "L2", conceptId: "c_14" });
    expect(log[3]).toMatchObject({ kind: "celebrate", conceptId: "c_14" });
    expect(log[4]).toMatchObject({ kind: "question", level: "L0", conceptId: "c_15" });
    expect(log[5]).toMatchObject({ kind: "question", level: "L1", conceptId: "c_15" });
    expect(run.concepts.find((c) => c.conceptId === "c_13")?.state).toBe("owned");
    expect(run.concepts.find((c) => c.conceptId === "c_14")?.state).toMatch(/assisted|owned|explained_to/);
  }, 90_000);
});
