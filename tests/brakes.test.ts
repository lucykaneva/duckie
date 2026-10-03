import { describe, expect, it } from "vitest";
import { DUCK, ENGINE } from "../src/lib/duck/config";
import type { JudgeResult } from "../src/lib/duck/types";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { feedbackFor } from "../src/lib/engine/celebration";
import { mustOpenUp, nextStreak, sessionLimit, skipCheckInDue } from "../src/lib/engine/brakes";
import { processSilence, silenceStepFor } from "../src/lib/engine/silence";
import { detectKeepGoing, detectWrapUpRequest } from "../src/lib/engine/signals";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import {
  freshSession,
  processTurn,
  type ConceptDef,
  type SessionRun,
  type TurnOutcome,
} from "../src/lib/engine/turn";
import {
  ACK_AFTER_EXPLAIN_LINE,
  ACK_LINE,
  ALL_ASKED_PROPOSAL_LINE,
  CHECK_IN_LINE,
  LIMIT_PROPOSAL_LINE,
  OFFER_SKIP_LINE,
  OPENING_LINE,
  OPEN_PROMPT_LINE,
  PAUSE_LINE,
  WRAP_UP_LINE,
  celebrationLine,
  wordCount,
} from "../src/lib/engine/wording";

// These tests cover the ladder and brakes with the plain "Got it, next question" flow (the spec's worked example).
// The reinforce step after a correct answer has its own tests in reinforce.test.ts.
ENGINE.reinforceAfterCorrect = false;

const MIN = 60_000;

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

const check = (id: string) => defs.find((d) => d.id === id)!.checkPrompt!;
const line = (id: string, level: "L1" | "L2" | "L3" | "L4") =>
  defs.find((d) => d.id === id)!.fallbackQuestions[level]!;

const judge = (parts: Partial<JudgeResult> = {}): JudgeResult => ({ ...emptyJudgeResult(), ...parts });

function turn(
  session: SessionRun,
  text: string,
  parts: { judge?: Partial<JudgeResult>; nowMs?: number; config?: typeof DUCK; defs?: ConceptDef[] } = {},
): TurnOutcome {
  return processTurn(
    parts.defs ?? defs,
    session,
    { text, judge: judge(parts.judge), nowMs: parts.nowMs },
    parts.config ?? DUCK,
  );
}

const conceptOf = (s: SessionRun, id: string) => s.concepts.find((c) => c.conceptId === id)!;

/** A session where the duck is already asking about `id`. */
function sessionAt(id: string, overrides: Partial<SessionRun["concepts"][number]> = {}, d: ConceptDef[] = defs): SessionRun {
  const s = freshSession(d);
  s.turnCount = 2;
  s.focusConceptId = id;
  s.lastMoveKind = "question";
  Object.assign(conceptOf(s, id), { moves: 1 }, overrides);
  return s;
}

/** Mark concepts as finished (Owned) without going through turns. */
function finish(s: SessionRun, ids: string[]): void {
  for (const id of ids) Object.assign(conceptOf(s, id), { state: "owned", moves: 1 });
}

/** `n` simple concepts, for the 6-concept limit. */
function manyDefs(n: number): ConceptDef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `x_${i + 1}`,
    topic: "Topic",
    name: `Idea ${i + 1}`,
    slide: i + 1,
    kind: "explain" as const,
    misconceptions: [],
    checkPrompt: `What is idea ${i + 1}?`,
    fallbackQuestions: {
      L1: `Idea ${i + 1} level one?`,
      L2: `Slide ${i + 1} shows idea ${i + 1}. What does it say?`,
      L3: `Idea ${i + 1} level three?`,
      L4: `Idea ${i + 1} is simple. Can you say it back?`,
    },
  }));
}

function expectSpokenRules(text: string) {
  expect(wordCount(text)).toBeLessThanOrEqual(DUCK.maxDuckWords);
  expect((text.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
}

describe("brake: move on", () => {
  it("skips the concept, acknowledges, and asks about the next one", () => {
    const o = turn(sessionAt("c_12"), "Let's move on");
    expect(conceptOf(o.session, "c_12")).toMatchObject({ state: "skipped", skipped: true });
    expect(o.move).toMatchObject({ kind: "question", conceptId: "c_13" });
    expect(o.move.line).toBe(`Okay. ${check("c_13")}`);
  });

  it("does not raise the skipped concept again this session", () => {
    let o = turn(sessionAt("c_12"), "skip this one");
    for (let i = 0; i < 6; i++) {
      expect(o.move.conceptId === "c_12" && o.move.kind !== "wrap_up").toBe(false);
      o = turn(o.session, "hmm the thing");
    }
  });

  it("says yes to 'Want to skip this one?' with a plain yes", () => {
    const s = sessionAt("c_12");
    s.lastMoveKind = "offer_skip";
    const o = turn(s, "yeah");
    expect(conceptOf(o.session, "c_12").state).toBe("skipped");
  });

  it("does not skip when the student is explaining", () => {
    const o = turn(sessionAt("c_13"), "Then you skip the left half and keep halving.");
    expect(conceptOf(o.session, "c_13").skipped).toBe(false);
  });
});

describe("brake: two skips", () => {
  it("does not check in after one skip", () => {
    const o = turn(sessionAt("c_12"), "skip");
    expect(o.move.kind).toBe("question");
    expect(o.session.skipCheckInAsked).toBe(false);
  });

  it("asks 'Keep going or wrap up?' once after the second skip", () => {
    const first = turn(sessionAt("c_12"), "skip");
    const second = turn(first.session, "let's move on");
    expect(second.move).toMatchObject({ kind: "check_in", sessionState: "active" });
    expect(second.move.line).toBe(`Okay. ${CHECK_IN_LINE}`);
    expect(second.session).toMatchObject({ pending: "check_in", skipCheckInAsked: true });
    // The skipped concept's follow-up question was not asked: that is the next concept's turn.
    expect(conceptOf(second.session, "c_14").moves).toBe(0);
  });

  it("never asks a second time", () => {
    const first = turn(sessionAt("c_12"), "skip");
    const second = turn(first.session, "skip");
    const keep = turn(second.session, "keep going");
    expect(keep.move.kind).toBe("question");
    const third = turn(keep.session, "skip this one");
    expect(third.move.kind).not.toBe("check_in");
  });

  it("'keep going' carries on without scoring anything", () => {
    const second = turn(turn(sessionAt("c_12"), "skip").session, "skip");
    const before = second.session.concepts.map((c) => ({ ...c }));
    const o = turn(second.session, "keep going");
    expect(o.move).toMatchObject({ kind: "question", conceptId: "c_14" });
    expect(o.move.line).toBe(check("c_14"));
    expect(o.session.concepts.map((c) => c.failedAttempts)).toEqual(before.map((c) => c.failedAttempts));
    expect(o.signals).toEqual([]);
    expect(o.session.pending).toBeNull();
  });

  it("'wrap up' closes the session", () => {
    const second = turn(turn(sessionAt("c_12"), "skip").session, "skip");
    const o = turn(second.session, "wrap up");
    expect(o.move).toMatchObject({ kind: "wrap_up", sessionState: "wrapping_up", line: WRAP_UP_LINE });
    expect(o.session.closing).toBe(true);
  });

  it("proposes wrapping up instead when nothing is left to ask", () => {
    const s = sessionAt("c_16");
    finish(s, ["c_12", "c_13", "c_14", "c_15"]);
    s.concepts.find((c) => c.conceptId === "c_12")!.skipped = true;
    s.concepts.find((c) => c.conceptId === "c_12")!.state = "skipped";
    s.concepts.find((c) => c.conceptId === "c_13")!.skipped = true;
    s.concepts.find((c) => c.conceptId === "c_13")!.state = "skipped";
    const o = turn(s, "skip");
    expect(o.move.kind).toBe("check_in");
    expect(o.move.line).toContain(ALL_ASKED_PROPOSAL_LINE);
    expect(o.session.pending).toBe("wrap_proposal");
  });

  it("is a pure decision", () => {
    expect(skipCheckInDue(1, false, DUCK)).toBe(false);
    expect(skipCheckInDue(2, false, DUCK)).toBe(true);
    expect(skipCheckInDue(3, true, DUCK)).toBe(false);
  });
});

describe("brake: question streak", () => {
  it("makes the move after two back-to-back questions an open prompt", () => {
    const o1 = turn(freshSession(defs), "Binary search is about lists.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "Binary search is about lists" }],
        missed: [{ conceptId: "c_12" }],
      },
    });
    expect(o1.move.kind).toBe("question");
    const o2 = turn(o1.session, "the list thing");
    expect(o2.move.kind).toBe("question");
    expect(o2.session.questionStreak).toBe(2);

    const o3 = turn(o2.session, "the list thing");
    expect(o3.move).toMatchObject({ kind: "open", conceptId: "c_12", line: OPEN_PROMPT_LINE });
    expect(o3.session.questionStreak).toBe(0);
    // The open prompt is not a ladder move.
    expect(conceptOf(o3.session, "c_12").moves).toBe(2);
    expect(conceptOf(o3.session, "c_12").levelReached).toBe("L2");
  });

  it("resumes the ladder after the open prompt", () => {
    let o = turn(freshSession(defs), "Binary search is about lists.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "Binary search is about lists" }],
        missed: [{ conceptId: "c_12" }],
      },
    });
    o = turn(o.session, "the list thing");
    o = turn(o.session, "the list thing");
    expect(o.move.kind).toBe("open");
    o = turn(o.session, "the list thing");
    expect(o.move).toMatchObject({ kind: "question", level: "L3", line: line("c_12", "L3") });
  });

  it("starts a new run after an acknowledgement", () => {
    const s = sessionAt("c_12");
    s.questionStreak = 2;
    const o = turn(s, "They have to be sorted.", {
      judge: { covered: [{ conceptId: "c_12", quote: "They have to be sorted" }] },
    });
    expect(o.move.kind).toBe("question");
    expect(o.move.line).toBe(`Got it. ${check("c_13")}`);
    expect(o.session.questionStreak).toBe(1);
  });

  it("is not triggered by an offer to skip", () => {
    const s = sessionAt("c_12", { score: 0.3, levelReached: "L3", moves: DUCK.maxMovesPerConcept, failedAttempts: 1 });
    s.questionStreak = 2;
    const o = turn(s, "the list thing");
    expect(o.move.kind).toBe("offer_skip");
    expect(o.session.questionStreak).toBe(0);
  });

  it("uses the configured streak length", () => {
    const o1 = turn(freshSession(defs), "Binary search is about lists.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "Binary search is about lists" }],
        missed: [{ conceptId: "c_12" }],
      },
      config: { ...DUCK, maxQuestionStreak: 1 },
    });
    const o2 = turn(o1.session, "the list thing", { config: { ...DUCK, maxQuestionStreak: 1 } });
    expect(o2.move.kind).toBe("open");
  });

  it("is a pure decision", () => {
    expect(mustOpenUp(2, "question", false, DUCK)).toBe(true);
    expect(mustOpenUp(1, "question", false, DUCK)).toBe(false);
    expect(mustOpenUp(2, "question", true, DUCK)).toBe(false);
    expect(mustOpenUp(2, "offer_skip", false, DUCK)).toBe(false);
    expect(nextStreak(1, "rephrase", false)).toBe(2);
    expect(nextStreak(2, "question", true)).toBe(1);
    expect(nextStreak(2, "celebrate", false)).toBe(0);
    expect(nextStreak(2, "open", false)).toBe(0);
  });
});

describe("brake: silence", () => {
  it("maps silence lengths to steps", () => {
    expect(silenceStepFor(7_999)).toBeNull();
    expect(silenceStepFor(8_000)).toBe(1);
    expect(silenceStepFor(19_999)).toBe(1);
    expect(silenceStepFor(20_000)).toBe(2);
    expect(silenceStepFor(44_999)).toBe(2);
    expect(silenceStepFor(45_000)).toBe(3);
  });

  it("8 s: rephrases at the same level and adds the silence signal once", () => {
    const s = sessionAt("c_14", { score: 0.3, levelReached: "L1", moves: 2 });
    s.lastLine = line("c_14", "L1");
    const o = processSilence(s, 1, 0)!;
    expect(o.move).toMatchObject({ kind: "rephrase", level: "L1", conceptId: "c_14", sessionState: "active" });
    expect(o.move.line).toBe(line("c_14", "L1"));
    expect(o.signals).toEqual(["silence"]);
    expect(o.scoreAfter).toBe(0.55);
    // Same level even though 0.55 is in the L2 band, and no ladder move used.
    expect(conceptOf(o.session, "c_14")).toMatchObject({ levelReached: "L1", moves: 2 });
    expect(o.session.silenceStep).toBe(1);
  });

  it("20 s: offers to skip, with no second silence signal", () => {
    const first = processSilence(sessionAt("c_14", { score: 0.1 }), 1, 0)!;
    const o = processSilence(first.session, 2, 0)!;
    expect(o.move).toMatchObject({ kind: "offer_skip", line: OFFER_SKIP_LINE, conceptId: "c_14" });
    expect(o.signals).toEqual([]);
    expect(conceptOf(o.session, "c_14").score).toBe(conceptOf(first.session, "c_14").score);
    // A plain yes to that offer skips the concept.
    const yes = turn(o.session, "yes");
    expect(conceptOf(yes.session, "c_14").state).toBe("skipped");
  });

  it("20 s on its own still counts the silence signal once", () => {
    const o = processSilence(sessionAt("c_14"), 2, 0)!;
    expect(o.move.kind).toBe("offer_skip");
    expect(o.signals).toEqual(["silence"]);
  });

  it("45 s: pauses the session", () => {
    const o = processSilence(sessionAt("c_14"), 3, 1_000)!;
    expect(o.move).toMatchObject({ kind: "pause", line: PAUSE_LINE, sessionState: "paused" });
    expect(o.session.pausedAtMs).toBe(1_000);
    // The question the duck was waiting on is remembered.
    expect(o.session.lastMoveKind).toBe("question");
    // A paused session ignores further timers.
    expect(processSilence(o.session, 3, 2_000)).toBeNull();
  });

  it("ignores a step that was already handled, or an earlier one", () => {
    const o = processSilence(sessionAt("c_14"), 2, 0)!;
    expect(processSilence(o.session, 1, 0)).toBeNull();
    expect(processSilence(o.session, 2, 0)).toBeNull();
    expect(processSilence(o.session, 3, 0)).not.toBeNull();
  });

  it("resets the steps when the student speaks", () => {
    const o = processSilence(sessionAt("c_14"), 2, 0)!;
    const after = turn(o.session, "the update thing");
    expect(after.session.silenceStep).toBe(0);
    expect(processSilence(after.session, 1, 0)).not.toBeNull();
  });

  it("repeats a check-in or proposal without scoring it", () => {
    const second = turn(turn(sessionAt("c_12"), "skip").session, "skip");
    const o = processSilence(second.session, 1, 0)!;
    expect(o.move).toMatchObject({ kind: "check_in", line: second.move.line });
    expect(o.signals).toEqual([]);
    const twenty = processSilence(second.session, 2, 0)!;
    expect(twenty.move.kind).toBe("check_in");
  });

  it("repeats the opening line when the student has not started", () => {
    const o = processSilence(freshSession(defs), 1, 0)!;
    expect(o.move).toMatchObject({ kind: "rephrase", line: OPENING_LINE });
    expect(o.signals).toEqual([]);
  });

  it("does nothing once the session is closing", () => {
    const s = sessionAt("c_14");
    s.closing = true;
    expect(processSilence(s, 1, 0)).toBeNull();
  });

  it("pauses without scoring, and 'I'm back' repeats the question", () => {
    const s = sessionAt("c_14", { score: 0.3, levelReached: "L1", moves: 2 });
    s.lastLine = line("c_14", "L1");
    const paused = processSilence(s, 3, 10 * 1_000)!;
    const back = turn(paused.session, "I'm back", { nowMs: 60 * 1_000 });
    expect(back.move).toMatchObject({ kind: "rephrase", line: line("c_14", "L1"), sessionState: "active" });
    expect(back.session.pausedAtMs).toBeNull();
    expect(conceptOf(back.session, "c_14").failedAttempts).toBe(0);
    // 0.3 plus the 0.25 silence signal from the timer; "I'm back" adds nothing.
    expect(conceptOf(back.session, "c_14").score).toBe(0.55);
  });

  it("scores a real answer after a pause normally", () => {
    const s = sessionAt("c_14", { score: 0.3, levelReached: "L1", moves: 2 });
    const paused = processSilence(s, 3, 0)!;
    const o = turn(paused.session, "After 7 there's nothing left, so just 5 and 7.", {
      judge: { covered: [{ conceptId: "c_14", quote: "just 5 and 7" }] },
      nowMs: 30_000,
    });
    expect(conceptOf(o.session, "c_14").state).toBe("assisted");
  });

  it("still honours 'skip' as the first word back", () => {
    const paused = processSilence(sessionAt("c_14"), 3, 0)!;
    const o = turn(paused.session, "skip", { nowMs: 30_000 });
    expect(conceptOf(o.session, "c_14").state).toBe("skipped");
  });

  it("keeps a pause out of the 8-minute limit", () => {
    const s = sessionAt("c_16");
    finish(s, ["c_12", "c_13", "c_14", "c_15"]);
    s.lastLine = check("c_16");
    // Paused at 2 min, back at 9 min: 7 minutes paused, 2 minutes of talking.
    const paused = processSilence(s, 3, 2 * MIN)!;
    const o = turn(paused.session, "About twenty.", {
      judge: { covered: [{ conceptId: "c_16", quote: "About twenty" }] },
      nowMs: 9 * MIN,
    });
    expect(o.move.line).toContain(ALL_ASKED_PROPOSAL_LINE);
    expect(o.move.line).not.toContain(LIMIT_PROPOSAL_LINE);
    expect(o.session.pausedMs).toBe(7 * MIN);
  });
});

describe("brake: session length", () => {
  const many = manyDefs(8);

  it("proposes wrapping up once 6 concepts are finished", () => {
    const s = sessionAt("x_6", {}, many);
    finish(s, ["x_1", "x_2", "x_3", "x_4", "x_5"]);
    const o = turn(s, "It is the sixth idea.", {
      defs: many,
      judge: { covered: [{ conceptId: "x_6", quote: "the sixth idea" }] },
    });
    expect(o.move).toMatchObject({ kind: "check_in", sessionState: "wrapping_up" });
    expect(o.move.line).toBe(`Got it. ${LIMIT_PROPOSAL_LINE}`);
    expect(o.session).toMatchObject({ pending: "wrap_proposal", wrapUpProposed: true });
  });

  it("does not propose at 5 concepts", () => {
    const s = sessionAt("x_5", {}, many);
    finish(s, ["x_1", "x_2", "x_3", "x_4"]);
    const o = turn(s, "It is the fifth idea.", {
      defs: many,
      judge: { covered: [{ conceptId: "x_5", quote: "the fifth idea" }] },
    });
    expect(o.move).toMatchObject({ kind: "question", conceptId: "x_6" });
  });

  it("proposes wrapping up at 8 minutes, not before", () => {
    const covered = { covered: [{ conceptId: "c_12", quote: "sorted" }] };
    const early = turn(sessionAt("c_12"), "It has to be sorted.", { judge: covered, nowMs: 8 * MIN - 1 });
    expect(early.move.kind).toBe("question");
    const late = turn(sessionAt("c_12"), "It has to be sorted.", { judge: covered, nowMs: 8 * MIN });
    expect(late.move).toMatchObject({ kind: "check_in", sessionState: "wrapping_up" });
  });

  it("does not cut in mid-ladder", () => {
    const s = sessionAt("c_12", { score: 0.3, levelReached: "L1", moves: 2 });
    const o = turn(s, "the list thing", { nowMs: 20 * MIN });
    expect(o.move.conceptId).toBe("c_12");
    expect(o.move.kind).not.toBe("check_in");
  });

  it("proposes only once, even if the student keeps going", () => {
    const s = sessionAt("c_12");
    const proposed = turn(s, "It has to be sorted.", {
      judge: { covered: [{ conceptId: "c_12", quote: "sorted" }] },
      nowMs: 9 * MIN,
    });
    expect(proposed.move.kind).toBe("check_in");
    const keep = turn(proposed.session, "keep going", { nowMs: 9 * MIN + 5_000 });
    expect(keep.move).toMatchObject({ kind: "question", conceptId: "c_13" });
    // Not scored: a reply to the proposal is not an answer about a concept.
    expect(keep.signals).toEqual([]);
    const next = turn(keep.session, "Halving is the middle.", {
      judge: { covered: [{ conceptId: "c_13", quote: "the middle" }] },
      nowMs: 10 * MIN,
    });
    expect(next.move.kind).toBe("question");
    expect(next.move.line).not.toContain("wrap up");
  });

  it("closes when the student agrees", () => {
    const proposed = turn(sessionAt("c_12"), "It has to be sorted.", {
      judge: { covered: [{ conceptId: "c_12", quote: "sorted" }] },
      nowMs: 9 * MIN,
    });
    for (const yes of ["yes", "sure", "okay", "let's wrap up"]) {
      const o = turn(proposed.session, yes, { nowMs: 9 * MIN + 1_000 });
      expect(o.move).toMatchObject({ kind: "wrap_up", line: WRAP_UP_LINE, sessionState: "wrapping_up" });
      expect(o.session.closing).toBe(true);
    }
  });

  it("keeps saying the closing line once closing", () => {
    const closing = turn(sessionAt("c_12"), "let's wrap up").session;
    const again = turn(closing, "wait, one more thing");
    expect(again.move.kind).toBe("wrap_up");
  });

  it("treats an explanation in reply to a proposal as a turn like any other", () => {
    const proposed = turn(sessionAt("c_12"), "It has to be sorted.", {
      judge: { covered: [{ conceptId: "c_12", quote: "sorted" }] },
      nowMs: 9 * MIN,
    });
    const o = turn(proposed.session, "Well it halves the range every time it checks the middle.", {
      judge: { covered: [{ conceptId: "c_13", quote: "halves the range" }] },
      nowMs: 9 * MIN + 1_000,
    });
    expect(conceptOf(o.session, "c_13").state).toBe("owned");
    expect(o.move.kind).not.toBe("wrap_up");
  });

  it("proposes wrapping up when every concept has been asked", () => {
    const s = sessionAt("c_16");
    finish(s, ["c_12", "c_13", "c_14", "c_15"]);
    const o = turn(s, "About twenty.", { judge: { covered: [{ conceptId: "c_16", quote: "About twenty" }] } });
    expect(o.move).toMatchObject({ kind: "check_in", sessionState: "wrapping_up" });
    expect(o.move.line).toContain(ALL_ASKED_PROPOSAL_LINE);
  });

  it("closes without asking again when the student turned it down and nothing is left", () => {
    const s = sessionAt("c_16");
    finish(s, ["c_12", "c_13", "c_14", "c_15", "c_16"]);
    s.pending = "wrap_proposal";
    s.wrapUpProposed = true;
    const o = turn(s, "no, keep going");
    expect(o.move).toMatchObject({ kind: "wrap_up", line: WRAP_UP_LINE });
    expect(o.session.closing).toBe(true);
  });

  it("is a pure decision", () => {
    expect(sessionLimit(5, 8 * MIN - 1, DUCK)).toBeNull();
    expect(sessionLimit(6, 0, DUCK)).toBe("concepts");
    expect(sessionLimit(0, 8 * MIN, DUCK)).toBe("time");
  });
});

describe("asking to stop", () => {
  it("honours an explicit request at any point", () => {
    for (const text of ["Let's wrap up", "I want to stop", "I'm done", "can we wrap this up", "stop", "okay I'm done."]) {
      const o = turn(sessionAt("c_14"), text);
      expect(o.move.kind, text).toBe("wrap_up");
      expect(o.session.closing, text).toBe(true);
    }
  });

  it("does not mistake an explanation for a request", () => {
    for (const text of [
      "I'm done with halving, now I check the middle.",
      "Then you stop when lo is bigger than hi.",
      "It keeps going until it stops.",
      "You finish when you find it.",
    ]) {
      expect(detectWrapUpRequest(text), text).toBe(false);
    }
  });

  it("reads 'keep going' replies", () => {
    for (const text of ["keep going", "Let's continue", "one more", "not yet", "no", "nope"]) {
      expect(detectKeepGoing(text), text).toBe(true);
    }
    expect(detectKeepGoing("It keeps halving")).toBe(false);
  });
});

describe("celebration", () => {
  it("celebrates a concept resolved after struggling (score reached 0.45), then moves on", () => {
    const s = sessionAt("c_14", { score: 0.45, levelReached: "L2", moves: 2 });
    finish(s, ["c_12", "c_13"]);
    const o = turn(s, "After 7 there's nothing left, so just 5 and 7.", {
      judge: { covered: [{ conceptId: "c_14", quote: "just 5 and 7" }] },
    });
    expect(o.move).toMatchObject({ kind: "celebrate", conceptId: "c_14", sessionState: "active" });
    expect(o.move.line).toBe("Ooh, nice. You got when it stops.");
    expect(o.move.then).toMatchObject({ kind: "question", level: "L0", conceptId: "c_15", line: check("c_15") });
    expect(conceptOf(o.session, "c_14").celebrated).toBe(true);
    // The server has asked the follow-up already.
    expect(conceptOf(o.session, "c_15").moves).toBe(1);
    expect(o.session.focusConceptId).toBe("c_15");
    expect(o.session.lastLine).toBe(check("c_15"));
    expect(o.session.questionStreak).toBe(1);
  });

  it("celebrates at L3 too, as long as the struggle was real", () => {
    const s = sessionAt("c_14", { score: 0.7, levelReached: "L3", moves: 3 });
    const o = turn(s, "just 5 and 7", { judge: { covered: [{ conceptId: "c_14", quote: "5 and 7" }] } });
    expect(o.move.kind).toBe("celebrate");
  });

  it("celebrates catching the planted mistake without help", () => {
    const s = sessionAt("c_15");
    finish(s, ["c_12", "c_13", "c_14"]);
    const o = turn(s, "No, that would loop forever, it has to be mid plus one.", {
      judge: { covered: [{ conceptId: "c_15", quote: "it has to be mid plus one" }] },
    });
    expect(o.move).toMatchObject({ kind: "celebrate", conceptId: "c_15" });
    expect(o.move.line).toBe("Ooh, you caught the mistake in the update step.");
    expect(o.move.then).toMatchObject({ conceptId: "c_16" });
  });

  it("does not celebrate the planted mistake after help", () => {
    const s = sessionAt("c_15", { score: 0.3, levelReached: "L1", moves: 2 });
    finish(s, ["c_12", "c_13", "c_14"]);
    const o = turn(s, "It loops forever.", { judge: { covered: [{ conceptId: "c_15", quote: "loops forever" }] } });
    expect(o.move.kind).toBe("question");
    expect(o.move.line).toBe(`Got it. ${check("c_16")}`);
  });

  it("only acknowledges a correct, unaided answer with no struggle", () => {
    const o = turn(sessionAt("c_12"), "It has to be sorted.", {
      judge: { covered: [{ conceptId: "c_12", quote: "sorted" }] },
    });
    expect(o.move.kind).toBe("question");
    expect(o.move.then).toBeUndefined();
    expect(o.move.line).toBe(`${ACK_LINE} ${check("c_13")}`);
    expect(conceptOf(o.session, "c_12").celebrated).toBe(false);
  });

  it("is neutral when the student only got it after the L4 explanation, even after real struggle", () => {
    const s = sessionAt("c_12", { score: 0.9, levelReached: "L4", moves: 4, failedAttempts: 4 });
    const o = turn(s, "Oh, it needs to be sorted so it can throw half away.", {
      judge: { covered: [{ conceptId: "c_12", quote: "needs to be sorted" }] },
    });
    expect(conceptOf(o.session, "c_12").state).toBe("explained_to");
    expect(o.move.kind).toBe("question");
    expect(o.move.then).toBeUndefined();
    expect(o.move.line).toBe(`${ACK_AFTER_EXPLAIN_LINE} ${check("c_13")}`);
    expect(conceptOf(o.session, "c_12").celebrated).toBe(false);
  });

  it("gives no praise for a vague answer, and the ladder continues", () => {
    const s = sessionAt("c_13", { score: 0.3, levelReached: "L1", moves: 2 });
    const o = turn(s, "It just works somehow.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "It just works" }],
        vague: [{ conceptId: "c_13", quote: "It just works" }],
      },
    });
    expect(conceptOf(o.session, "c_13").state).toBe("not_yet");
    expect(o.move.kind).not.toBe("celebrate");
    expect(o.move.line).not.toMatch(/nice|got it|great/i);
    expect(o.move.conceptId).toBe("c_13");
  });

  it("celebrates a concept once", () => {
    const base = { previous: 0.6, explainedTo: false, unaided: false, plantsMisconception: false };
    expect(feedbackFor({ ...base, alreadyCelebrated: false }, DUCK)).toEqual({ kind: "celebrate", caught: false });
    expect(feedbackFor({ ...base, alreadyCelebrated: true }, DUCK)).toEqual({ kind: "ack", line: ACK_LINE });
  });

  it("covers every row of the feedback table", () => {
    const f = (over: Partial<Parameters<typeof feedbackFor>[0]>) =>
      feedbackFor(
        { previous: 0, explainedTo: false, unaided: true, plantsMisconception: false, alreadyCelebrated: false, ...over },
        DUCK,
      );
    expect(f({ previous: DUCK.earnedScore, unaided: false })).toEqual({ kind: "celebrate", caught: false });
    expect(f({ previous: DUCK.earnedScore - 0.01, unaided: false })).toEqual({ kind: "ack", line: ACK_LINE });
    expect(f({ plantsMisconception: true })).toEqual({ kind: "celebrate", caught: true });
    expect(f({ plantsMisconception: true, unaided: false })).toEqual({ kind: "ack", line: ACK_LINE });
    expect(f({})).toEqual({ kind: "ack", line: ACK_LINE });
    expect(f({ previous: 1, explainedTo: true, unaided: false })).toEqual({
      kind: "ack",
      line: ACK_AFTER_EXPLAIN_LINE,
    });
  });

  it("follows a celebration with a wrap-up proposal when nothing is left", () => {
    const s = sessionAt("c_16", { score: 0.5, levelReached: "L2", moves: 2 });
    finish(s, ["c_12", "c_13", "c_14", "c_15"]);
    const o = turn(s, "About twenty.", { judge: { covered: [{ conceptId: "c_16", quote: "About twenty" }] } });
    expect(o.move.kind).toBe("celebrate");
    expect(o.move.then).toMatchObject({ kind: "check_in", sessionState: "wrapping_up", line: ALL_ASKED_PROPOSAL_LINE });
    expect(o.session.pending).toBe("wrap_proposal");
  });

  it("keeps every celebration line within the speaking rules", () => {
    for (const d of defs) {
      expectSpokenRules(celebrationLine(d.name, false));
      expectSpokenRules(celebrationLine(d.name, true));
    }
    const long = "A very long concept name that goes on and on about many different matters at great length indeed";
    expectSpokenRules(celebrationLine(long, false));
    expectSpokenRules(celebrationLine(long, true));
    expect(celebrationLine(long, false)).toBe("Ooh, nice. You got that one.");
  });
});

describe("every line the brakes speak", () => {
  it("is 20 words or fewer with at most one question", () => {
    for (const text of [
      OPEN_PROMPT_LINE,
      CHECK_IN_LINE,
      PAUSE_LINE,
      WRAP_UP_LINE,
      ALL_ASKED_PROPOSAL_LINE,
      LIMIT_PROPOSAL_LINE,
      OFFER_SKIP_LINE,
      `Okay. ${CHECK_IN_LINE}`,
      `Got it. ${LIMIT_PROPOSAL_LINE}`,
    ]) {
      expectSpokenRules(text);
    }
  });
});
