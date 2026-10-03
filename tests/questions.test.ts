// Two bugs from the first real session:
//  1. "Ready to wrap up?" -> "Is it log three of one million?"  The duck said "Okay, let's wrap up."
//  2. "So I could use it on my pebbles?" -> "What do you mean by pebbles?"  The duck climbed to L2.
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { needsJudge } from "../src/lib/engine/orchestrate";
import { detectClarification, detectQuestion } from "../src/lib/engine/signals";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import {
  ALL_ASKED_PROPOSAL_LINE,
  ASK_AGAIN_CHECK_IN_LINE,
  ASK_AGAIN_PROPOSAL_LINE,
  CHECK_IN_LINE,
  WRAP_UP_LINE,
  wordCount,
} from "../src/lib/engine/wording";

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

const turn = (run: SessionRun, text: string) =>
  processTurn(defs, run, { text, judge: emptyJudgeResult(), nowMs: 60_000 });

/** Every idea asked and finished, and the duck has just asked "Ready to wrap up?". */
function proposalPending(): SessionRun {
  const run = freshSession(defs);
  run.concepts.forEach((c) => {
    c.state = "owned";
    c.moves = 1;
  });
  return {
    ...run,
    turnCount: 6,
    lastMoveKind: "check_in",
    lastLine: ALL_ASKED_PROPOSAL_LINE,
    pending: "wrap_proposal",
    wrapUpProposed: true,
  };
}

describe("detectClarification / detectQuestion", () => {
  it("recognises someone asking what the duck meant", () => {
    for (const text of [
      "What do you mean by pebbles?",
      "what does that mean",
      "Sorry?",
      "Can you repeat that",
      "Say that again please",
      "I don't understand the question",
      "What's a pebble?",
      "Huh",
    ]) {
      expect(detectClarification(text), text).toBe(true);
    }
  });

  it("does not mistake an explanation or an answer for it", () => {
    for (const text of [
      "You halve the list each time",
      "I check 5, and then 7.",
      "What's left is the right half, so you search that",
      "Because the middle is too small",
    ]) {
      expect(detectClarification(text), text).toBe(false);
    }
  });

  it("sees a question by its question mark or its first word", () => {
    expect(detectQuestion("Is it log three of one million?")).toBe(true);
    expect(detectQuestion("why does that work")).toBe(true);
    expect(detectQuestion("Yes please.")).toBe(false);
    expect(detectQuestion("Keep going")).toBe(false);
  });
});

describe("a question in reply to 'Ready to wrap up?'", () => {
  it("does not wrap up the session", () => {
    const out = turn(proposalPending(), "Is it log three of one million?");
    expect(out.move.kind).toBe("check_in");
    expect(out.move.line).toBe(ASK_AGAIN_PROPOSAL_LINE);
    expect(out.session.closing).toBe(false);
    expect(out.session.pending).toBe("wrap_proposal"); // still waiting for a real yes or no
    expect(out.signals).toEqual([]);
    expect(out.resolved).toEqual([]);
    expect(wordCount(out.move.line)).toBeLessThanOrEqual(20);
    expect((out.move.line.match(/\?/g) ?? []).length).toBe(1);
  });

  it("still wraps up on a real yes afterwards", () => {
    const asked = turn(proposalPending(), "Is it log three of one million?");
    const out = turn(asked.session, "Yes please");
    expect(out.move.kind).toBe("wrap_up");
    expect(out.move.line).toBe(WRAP_UP_LINE);
    expect(out.session.closing).toBe(true);
  });

  it("asks the check-in again when that was the pending question", () => {
    const run = { ...proposalPending(), pending: "check_in" as const, lastLine: CHECK_IN_LINE };
    const out = turn(run, "Wait, is that right?");
    expect(out.move.line).toBe(ASK_AGAIN_CHECK_IN_LINE);
    expect(out.session.pending).toBe("check_in");
    expect(out.session.closing).toBe(false);
  });

  it("repeats the duck's own line when the student just did not understand it", () => {
    const out = turn(proposalPending(), "Sorry, what do you mean?");
    expect(out.move.line).toBe(ALL_ASKED_PROPOSAL_LINE);
    expect(out.session.closing).toBe(false);
  });

  it("does not spend a Grok call on it", () => {
    expect(needsJudge(proposalPending(), "Is it log three of one million?")).toBe(false);
  });
});

describe("'What do you mean by pebbles?'", () => {
  const PEBBLES = "So I could use it on my pebbles? They're all mixed up.";
  function afterFirstQuestion(): SessionRun {
    const run = freshSession(defs);
    const c = run.concepts.find((x) => x.conceptId === "c_12")!;
    c.levelReached = "L1";
    c.moves = 1;
    return { ...run, turnCount: 2, focusConceptId: "c_12", lastMoveKind: "question", lastLine: PEBBLES };
  }

  it("repeats the question at the same level instead of climbing the ladder", () => {
    const out = turn(afterFirstQuestion(), "What do you mean by pebbles?");
    expect(out.move.kind).toBe("rephrase");
    expect(out.move.level).toBe("L1");
    expect(out.move.conceptId).toBe("c_12");
    expect(out.move.line).toBe(PEBBLES); // wordMove rewords a rephrase; this is the fallback if it can't
    const c = out.session.concepts.find((x) => x.conceptId === "c_12")!;
    expect(c.levelReached).toBe("L1");
    expect(c.score).toBe(0);
    expect(c.failedAttempts).toBe(0);
    expect(c.moves).toBe(1); // not another ask
    expect(out.signals).toEqual([]);
  });

  it("does not spend a Grok call on it", () => {
    expect(needsJudge(afterFirstQuestion(), "What do you mean by pebbles?")).toBe(false);
  });

  it("still treats 'I don't know' as a real struggle", () => {
    const out = turn(afterFirstQuestion(), "I don't know");
    expect(out.signals).toContain("dontKnow");
  });
});
