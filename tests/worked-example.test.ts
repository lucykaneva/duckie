/**
 * B15: the spec's whole binary-search session as one script.
 *
 * The judge returns the expected structure. Code decides scores, levels and moves.
 * "Line category" is kind + level + concept (and the seed fallback for that category).
 * Live Grok wording is Dev A's; this file does not call it.
 *
 * Voice barge-in and pause-after-"and" are Dev A's A13, not this list.
 *
 * Pre-demo B suites (already green, not re-run here):
 *   scoring  tests/score.test.ts
 *   ladder   tests/ladder.test.ts
 *   brakes   tests/brakes.test.ts
 *   leak     tests/answers.test.ts, tests/wordMove.leak.test.ts
 *   AI-off   tests/fallback-session.test.ts
 */
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { DUCK, ENGINE } from "../src/lib/duck/config";
import type { DuckMove, JudgeResult, Level, MoveKind } from "../src/lib/duck/types";
import { findLeak } from "../src/lib/engine/answers";
import { buildDebrief } from "../src/lib/engine/debrief";
import { guardMove } from "../src/lib/engine/guard";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import {
  freshSession,
  openingMove,
  processTurn,
  type ConceptDef,
  type SessionRun,
  type TurnInput,
  type TurnOutcome,
} from "../src/lib/engine/turn";
import { wordCount } from "../src/lib/engine/wording";

// The spec's worked example is the plain "Got it, next question" flow.
ENGINE.reinforceAfterCorrect = false;

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

const TRACE_ANSWER = "[5,7]";
const TRACE_SECRET = {
  expectedAnswer: TRACE_ANSWER,
  givenText: defs.find((d) => d.id === "c_14")!.checkPrompt ?? undefined,
};
const answers = [{ conceptId: "c_14", expectedAnswer: TRACE_ANSWER }];

const judge = (parts: Partial<JudgeResult>): JudgeResult => ({ ...emptyJudgeResult(), ...parts });

function run(
  session: SessionRun,
  text: string,
  parts: { judge?: Partial<JudgeResult>; answer?: TurnInput["answer"] } = {},
): TurnOutcome {
  return processTurn(defs, session, { text, judge: judge(parts.judge ?? {}), answer: parts.answer });
}

const stateOf = (session: SessionRun, id: string) => session.concepts.find((c) => c.conceptId === id)!;

function category(move: DuckMove): [MoveKind, Level, string] {
  return [move.kind, move.level, move.conceptId];
}

function assertLineLimits(line: string) {
  expect(wordCount(line)).toBeLessThanOrEqual(DUCK.maxDuckWords);
  expect((line.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
}

function assertNoLeak(line: string) {
  expect(findLeak(line, [TRACE_SECRET])).toBeNull();
}

describe("B15 worked example (binary search)", () => {
  it("replays every spec-table level and line category, then the debrief", () => {
    const spoken: string[] = [];
    const log: Array<[MoveKind, Level, string]> = [];
    let committed: string[] = [];

    const speak = (move: DuckMove) => {
      const guarded = guardMove(move, defs, answers, committed).move;
      log.push(category(guarded));
      spoken.push(guarded.line);
      assertLineLimits(guarded.line);
      assertNoLeak(guarded.line);
      if (guarded.then) {
        log.push(category(guarded.then));
        spoken.push(guarded.then.line);
        assertLineLimits(guarded.then.line);
        assertNoLeak(guarded.then.line);
      }
      return guarded;
    };

    // Spec turn 1: session opens. Not a /turn.
    const open = speak(openingMove(defs));
    expect(open).toMatchObject({
      kind: "open",
      level: "L0",
      line: "I don't really get binary search yet. How does it work?",
    });
    expect(open.concepts.every((c) => c.state === "not_yet" && c.score === 0)).toBe(true);

    let s = freshSession(defs);

    // Spec turn 2: explanation. Halving owned, sorted input missed → L1.
    let o = run(s, "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "You keep halving" }],
        missed: [{ conceptId: "c_12" }],
      },
    });
    expect(stateOf(o.session, "c_13").state).toBe("owned");
    expect(stateOf(o.session, "c_12")).toMatchObject({ state: "not_yet", score: 0.3 });
    expect(speak(o.move)).toMatchObject({
      kind: "question",
      level: "L1",
      conceptId: "c_12",
      line: "So I could use it on my pebbles? They're all mixed up.",
    });
    s = o.session;

    // Spec turn 3: sorted input assisted, not earned. Duck asks the trace (L0).
    o = run(s, "No, they have to be sorted, or you could throw away the half with the target.", {
      judge: { covered: [{ conceptId: "c_12", quote: "they have to be sorted" }] },
    });
    expect(stateOf(o.session, "c_12")).toMatchObject({ state: "assisted", score: 0, levelReached: "L1" });
    expect(o.resolved[0].previous).toBeLessThan(DUCK.earnedScore);
    const movedOn = speak(o.move);
    expect(movedOn).toMatchObject({ kind: "ack", line: "Got it.", conceptId: "c_12" });
    expect(movedOn.then).toMatchObject({
      kind: "question",
      level: "L0",
      conceptId: "c_14",
      line: "Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?",
    });
    s = o.session;

    // Spec turn 4: wrong trace + hedging = 0.45 → L2. Duck must not say "5 and 7".
    o = run(s, "Um, I think 5, then 7, then maybe 9?", {
      answer: { conceptId: "c_14", correct: false },
    });
    expect(o.signals).toEqual(["wrongTrace", "hedging"]);
    expect(stateOf(o.session, "c_14").score).toBe(0.45);
    const help = speak(o.move);
    expect(help).toMatchObject({
      kind: "question",
      level: "L2",
      conceptId: "c_14",
      line: "What has to be true before you stop looking?",
    });
    expect(help.line).not.toMatch(/5\s+and\s+7/);
    s = o.session;

    // Spec turns 5–6: correct and earned. Celebrate, then the planted update-step claim.
    o = run(s, "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.", {
      answer: { conceptId: "c_14", correct: true },
    });
    committed = ["c_14"];
    expect(stateOf(o.session, "c_14")).toMatchObject({ state: "assisted", score: 0, levelReached: "L2" });
    expect(o.resolved[0].previous).toBeGreaterThanOrEqual(DUCK.earnedScore);
    const celebrated = speak(o.move);
    expect(celebrated).toMatchObject({ kind: "celebrate", conceptId: "c_14" });
    // Category is celebrate. Seed fallback says "got"; wordMove may say the spec's "found".
    expect(celebrated.line).toBe("Mm. You just got when it stops.");
    expect(celebrated.then).toMatchObject({
      kind: "question",
      level: "L0",
      conceptId: "c_15",
      line: "My friend wrote lo = mid, not mid + 1. Is that okay?",
    });
    s = o.session;

    // Spec turn 7: misconception → L1.
    o = run(s, "I think that's fine?", {
      judge: { misconceptions: [{ conceptId: "c_15", quote: "I think that's fine?" }] },
    });
    expect(stateOf(o.session, "c_15")).toMatchObject({ state: "misconception", score: 0.3 });
    expect(speak(o.move)).toMatchObject({
      kind: "question",
      level: "L1",
      conceptId: "c_15",
      line: "What happens to lo when it's right next to hi?",
    });
    s = o.session;

    // Spec turns 8–9: update step assisted, not earned. "Got it." is its own beat, then the next question.
    o = run(s, "It stays the same… so it loops forever.", {
      judge: { covered: [{ conceptId: "c_15", quote: "it loops forever" }] },
    });
    expect(stateOf(o.session, "c_15")).toMatchObject({ state: "assisted", score: 0 });
    expect(o.resolved[0].previous).toBeLessThan(DUCK.earnedScore);
    const gotIt = speak(o.move);
    expect(gotIt).toMatchObject({ kind: "ack", line: "Got it." });
    expect(gotIt.then).toMatchObject({
      kind: "question",
      level: "L0",
      conceptId: "c_16",
      line: "How many checks for a million items?",
    });
    s = o.session;

    expect(log).toEqual([
      ["open", "L0", "c_12"],
      ["question", "L1", "c_12"],
      ["ack", "L1", "c_12"],
      ["question", "L0", "c_14"],
      ["question", "L2", "c_14"],
      ["celebrate", "L2", "c_14"],
      ["question", "L0", "c_15"],
      ["question", "L1", "c_15"],
      ["ack", "L1", "c_15"],
      ["question", "L0", "c_16"],
    ]);
    expect(s.concepts.map((c) => c.state)).toEqual([
      "assisted",
      "owned",
      "assisted",
      "assisted",
      "not_yet",
    ]);

    // Spec debrief after the table: O(log n) still depends on the next turn.
    const { results, recall } = buildDebrief({
      sessionId: "s_worked_example",
      topic: "Binary search",
      confidence: 3,
      defs,
      concepts: s.concepts,
      celebrationLine: celebrated.line,
      today: "2026-10-03",
    });
    expect(results.understanding).toBe(50);
    expect(results.illusionScore).toBe(10);
    expect(results.reviseNext).toBe("O(log n)");
    expect(recall.map((r) => [r.conceptId, r.stateAfter, r.intervalDays])).toEqual([
      ["c_12", "assisted", 2],
      ["c_13", "owned", 4],
      ["c_14", "assisted", 2],
      ["c_15", "assisted", 2],
      ["c_16", "not_yet", 1],
    ]);

    // Spec: "O(log n) depends on turn 10."
    o = run(s, "About twenty.", {
      judge: { covered: [{ conceptId: "c_16", quote: "About twenty" }] },
    });
    expect(stateOf(o.session, "c_16").state).toBe("owned");
    expect(speak(o.move).then).toMatchObject({ kind: "check_in", sessionState: "wrapping_up" });
    expect(o.session.pending).toBe("wrap_proposal");
    expect(o.session.concepts.map((c) => c.state)).toEqual([
      "assisted",
      "owned",
      "assisted",
      "assisted",
      "owned",
    ]);
    expect(spoken).toHaveLength(12);
  });
});
