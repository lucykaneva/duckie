// Two bugs from the first real session:
//  1. "Ready to wrap up?" -> "Is it log three of one million?"  The duck said "Okay, let's wrap up."
//  2. "So I could use it on my pebbles?" -> "What do you mean by pebbles?"  The duck climbed to L2.
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { needsJudge } from "../src/lib/engine/orchestrate";
import { detectAskingQuestion, detectClarification, detectQuestion } from "../src/lib/engine/signals";
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

describe("a question means the student needs help", () => {
  function midConcept(): SessionRun {
    const run = freshSession(defs);
    const c = run.concepts.find((x) => x.conceptId === "c_12")!;
    c.levelReached = "L1";
    c.moves = 1;
    return { ...run, turnCount: 2, focusConceptId: "c_12", lastMoveKind: "question", lastLine: "Where would you start?" };
  }

  it("tells a real question from an explanation that ends in 'right?'", () => {
    for (const text of ["Is it log n?", "Why does that work", "How would that go with 9 numbers?"]) {
      expect(detectAskingQuestion(text), text).toBe(true);
    }
    for (const text of [
      "You halve the list each time, right?",
      "What's left is the right half so you search that and keep halving until you find it, okay?",
      "Is it log n? Is it n squared?",
      "What do you mean by pebbles?", // that is a clarification, handled separately
      "Keep going",
    ]) {
      expect(detectAskingQuestion(text), text).toBe(false);
    }
  });

  it("gives a hint (L3) on the idea in focus, and scores nothing", () => {
    const out = turn(midConcept(), "Is it log n?");
    expect(out.move.level).toBe("L3");
    expect(out.move.conceptId).toBe("c_12");
    expect(out.signals).toEqual([]);
    expect(out.resolved).toEqual([]);
    const c = out.session.concepts.find((x) => x.conceptId === "c_12")!;
    expect(c.score).toBe(0);
    expect(c.failedAttempts).toBe(0); // asking for help is not an attempt
    expect(out.session.closing).toBe(false);
  });

  it("does not spend a Grok call on it", () => {
    expect(needsJudge(midConcept(), "Is it log n?")).toBe(false);
  });

  it("gives a hint, not 'ready to wrap up', when it was asked mid-wrap-up with an idea still open", () => {
    const run = { ...midConcept(), pending: "check_in" as const, lastMoveKind: "check_in" as const, lastLine: CHECK_IN_LINE };
    const out = turn(run, "Wait, how does that work?");
    expect(out.move.level).toBe("L3");
    expect(out.move.kind).not.toBe("wrap_up");
    expect(out.session.pending).toBeNull(); // the question answered the check-in
    expect(out.session.closing).toBe(false);
  });

  it("asks for their guess when there is nothing open to help with", () => {
    const out = turn(proposalPending(), "Is it log three of one million?");
    expect(out.move.line).toBe(ASK_AGAIN_PROPOSAL_LINE);
    expect(out.move.line).toMatch(/guess/);
  });
});

// The real session where the duck said "Want to skip this one?" twice, even though the student asked it to explain.
describe("the move cap does not stop the duck from explaining", () => {
  function stuck(): SessionRun {
    const run = freshSession(defs);
    const c = run.concepts.find((x) => x.conceptId === "c_15")!;
    Object.assign(c, { levelReached: "L2", moves: 5, failedAttempts: 4, score: 1, state: "misconception" });
    return { ...run, turnCount: 6, focusConceptId: "c_15", lastMoveKind: "question", lastLine: "Why do you think that?" };
  }
  const L4_LINE = defs.find((d) => d.id === "c_15")!.fallbackQuestions.L4;

  it("explains (L4) when the student asks 'Can you explain it?' after the cap", () => {
    const out = turn(stuck(), "Can you explain it?");
    expect(out.move.kind).not.toBe("offer_skip");
    expect(out.move.level).toBe("L4");
    expect(out.move.line).toBe(L4_LINE);
    expect(out.session.concepts.find((c) => c.conceptId === "c_15")!.levelReached).toBe("L4");
  });

  it("explains when the student is stuck for good ('I have no idea') instead of offering to skip", () => {
    const out = turn(stuck(), "I have no idea.");
    expect(out.move.level).toBe("L4");
    expect(out.move.kind).not.toBe("offer_skip");
  });

  it("offers to skip only after the explanation has been given", () => {
    const explained = turn(stuck(), "Can you explain it?");
    const out = turn(explained.session, "I still have no idea.");
    expect(out.move.kind).toBe("offer_skip");
  });

  it("still offers to skip at the cap when the student is not asking for help and is not stuck", () => {
    const run = stuck();
    const c = run.concepts.find((x) => x.conceptId === "c_15")!;
    Object.assign(c, { score: 0.5, failedAttempts: 1, levelReached: "L2" });
    const out = turn(run, "Hmm.");
    expect(out.move.level).not.toBe("L4");
  });
});
