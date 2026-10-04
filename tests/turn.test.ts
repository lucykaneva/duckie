import { describe, expect, it } from "vitest";
import { DUCK, ENGINE } from "../src/lib/duck/config";
import type { JudgeResult } from "../src/lib/duck/types";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
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
import { offerSkipLine, withAck, wordCount } from "../src/lib/engine/wording";

// These tests cover the ladder and brakes with the plain "Got it, next question" flow (the spec's worked example).
// The reinforce step after a correct answer has its own tests in reinforce.test.ts.
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

const line = (id: string, level: "L1" | "L2" | "L3" | "L4") =>
  defs.find((d) => d.id === id)!.fallbackQuestions[level]!;

const judge = (parts: Partial<JudgeResult>): JudgeResult => ({ ...emptyJudgeResult(), ...parts });

function run(
  session: SessionRun,
  text: string,
  parts: { judge?: Partial<JudgeResult>; answer?: TurnInput["answer"] } = {},
  config = DUCK,
): TurnOutcome {
  return processTurn(defs, session, { text, judge: judge(parts.judge ?? {}), answer: parts.answer }, config);
}

const stateOf = (outcome: TurnOutcome, id: string) =>
  outcome.session.concepts.find((c) => c.conceptId === id)!;

/** A session where the duck is already asking about `id`, with the given overrides. */
function sessionAt(id: string, overrides: Partial<SessionRun["concepts"][number]> = {}): SessionRun {
  const s = freshSession(defs);
  s.turnCount = 2;
  s.focusConceptId = id;
  s.lastMoveKind = "question";
  const c = s.concepts.find((x) => x.conceptId === id)!;
  Object.assign(c, { moves: 1 }, overrides);
  return s;
}

describe("opening move", () => {
  it("does not quiz when Grok has not seen them teach yet", () => {
    const o = run(freshSession(defs), "Hello?", { judge: { missed: [{ conceptId: "c_12" }] } });
    expect(o.move.kind).toBe("open");
    expect(o.signals).toEqual([]);
    expect(o.session.concepts.every((c) => c.score === 0 && c.moves === 0 && c.state === "not_yet")).toBe(true);
  });

  it("opens with the spec's line and every concept Not yet", () => {
    const move = openingMove(defs);
    expect(move.kind).toBe("open");
    expect(move.line).toBe("I don't really get binary search yet. How does it work?");
    expect(move.sessionState).toBe("active");
    expect(move.concepts).toHaveLength(5);
    expect(move.concepts.every((c) => c.state === "not_yet" && c.score === 0)).toBe(true);
  });

  it("does not repeat the opening when they only said hello", () => {
    const o = run(freshSession(defs), "Hello?");
    expect(o.move.kind).toBe("open");
    expect(o.move.line).not.toBe(openingMove(defs).line);
    expect(o.move.line).not.toMatch(/walk me through/i);
  });

  it("starts one small curious question when they say they forgot", () => {
    const o = run(freshSession(defs), "Hm, I'm not really sure to be honest, I kinda forgot.");
    expect(o.move.kind).toBe("question");
    expect(o.move.level).toBe("L1");
    expect(o.move.conceptId).toBe("c_12");
    expect(o.move.line).toBe("So I could use it on my pebbles? They're all mixed up.");
    expect(o.signals).toEqual([]);
  });

  it("names the topic when they ask through what, and does not repeat the opening", () => {
    const o = run(freshSession(defs), "Hello, through what?");
    expect(o.move.kind).toBe("open");
    expect(o.move.line).toMatch(/binary search/i);
    expect(o.move.line).not.toBe(openingMove(defs).line);
    expect(o.move.line).not.toMatch(/walk me through|just a duck/i);
  });
});

// The spec's worked example, turn by turn. Student turn numbers here count finished
// /turn calls: the spec's "Jordan opens with the topic" is the session start.
describe("worked example (binary search)", () => {
  it("replays every level, state and line", () => {
    const lines: string[] = [];
    let s = freshSession(defs);

    // 1. The explanation turn: halving covered, sorted input missed.
    let o = run(s, "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "You keep halving" }],
        missed: [{ conceptId: "c_12" }],
      },
    });
    expect(stateOf(o, "c_13").state).toBe("owned");
    expect(stateOf(o, "c_12")).toMatchObject({ state: "not_yet", score: 0.3 });
    expect(o.move).toMatchObject({ kind: "question", level: "L1", conceptId: "c_12", sessionState: "active" });
    expect(o.move.line).toBe("So I could use it on my pebbles? They're all mixed up.");
    lines.push(o.move.line);
    s = o.session;

    // 2. Sorted input resolved after L1 -> Assisted. The duck moves on to the trace question.
    o = run(s, "No, they have to be sorted, or you could throw away the half with the target.", {
      judge: { covered: [{ conceptId: "c_12", quote: "they have to be sorted" }] },
    });
    expect(stateOf(o, "c_12")).toMatchObject({ state: "assisted", score: 0, levelReached: "L1" });
    expect(o.resolved[0].previous).toBeLessThan(DUCK.earnedScore); // not earned
    expect(o.move).toMatchObject({ kind: "ack", line: "Got it.", conceptId: "c_12" });
    expect(o.move.then).toMatchObject({
      kind: "question",
      level: "L0",
      conceptId: "c_14",
      line: "Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?",
    });
    lines.push(o.move.line);
    s = o.session;

    // 3. Wrong trace + hedging = 0.45 -> L2.
    o = run(s, "Um, I think 5, then 7, then maybe 9?", {
      answer: { conceptId: "c_14", correct: false },
    });
    expect(o.signals).toEqual(["wrongTrace", "hedging"]);
    expect(stateOf(o, "c_14").score).toBe(0.45);
    expect(o.move).toMatchObject({ kind: "question", level: "L2", conceptId: "c_14" });
    expect(o.move.line).toBe("What has to be true before you stop looking?");
    lines.push(o.move.line);
    s = o.session;

    // 4. Correct -> Assisted, and the struggle before it was earned.
    o = run(s, "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.", {
      answer: { conceptId: "c_14", correct: true },
    });
    expect(stateOf(o, "c_14")).toMatchObject({ state: "assisted", score: 0, levelReached: "L2" });
    expect(o.resolved[0].previous).toBeGreaterThanOrEqual(DUCK.earnedScore); // earned
    // Earned, so the duck celebrates; 1.5 s later it moves on to the update step (spec turns 5 and 6).
    expect(o.move).toMatchObject({ kind: "celebrate", conceptId: "c_14" });
    expect(o.move.line).toBe("Mm. You just got when it stops.");
    expect(o.move.then).toMatchObject({ kind: "question", level: "L0", conceptId: "c_15" });
    expect(o.move.then!.line).toBe("My friend wrote lo = mid, not mid + 1. Is that okay?");
    lines.push(o.move.line, o.move.then!.line);
    s = o.session;

    // 5. Misconception on the update step -> L1.
    o = run(s, "I think that's fine?", {
      judge: { misconceptions: [{ conceptId: "c_15", quote: "I think that's fine?" }] },
    });
    expect(stateOf(o, "c_15")).toMatchObject({ state: "misconception", score: 0.3 });
    expect(o.move).toMatchObject({ kind: "question", level: "L1", conceptId: "c_15" });
    expect(o.move.line).toBe("What happens to lo when it's right next to hi?");
    lines.push(o.move.line);
    s = o.session;

    // 6. Fixed it unaided -> Assisted. Not earned (0.3). Next: O(log n).
    o = run(s, "It stays the same… so it loops forever.", {
      judge: { covered: [{ conceptId: "c_15", quote: "it loops forever" }] },
    });
    expect(stateOf(o, "c_15")).toMatchObject({ state: "assisted", score: 0 });
    expect(o.resolved[0].previous).toBeLessThan(DUCK.earnedScore);
    expect(o.move).toMatchObject({ kind: "ack", line: "Got it." });
    expect(o.move.then).toMatchObject({
      level: "L0",
      conceptId: "c_16",
      line: "How many checks for a million items?",
    });
    lines.push(o.move.line);
    s = o.session;

    // 7. Last concept Owned with no help -> nothing left, propose wrapping up.
    o = run(s, "About twenty.", {
      judge: { covered: [{ conceptId: "c_16", quote: "About twenty" }] },
    });
    expect(stateOf(o, "c_16").state).toBe("owned");
    expect(o.move.then).toMatchObject({ kind: "check_in", sessionState: "wrapping_up" });
    expect(o.session.pending).toBe("wrap_proposal");
    lines.push(o.move.line);

    expect(o.session.concepts.map((c) => c.state)).toEqual([
      "assisted",
      "owned",
      "assisted",
      "assisted",
      "owned",
    ]);

    // Every line the duck spoke respects the limits.
    for (const l of lines) {
      expect(wordCount(l)).toBeLessThanOrEqual(DUCK.maxDuckWords);
      expect((l.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("one move per turn", () => {
  it("picks the struggling concept with the highest score, then deck order", () => {
    const s = freshSession(defs);
    s.turnCount = 1;
    s.concepts[3].score = 0.5; // c_15
    s.concepts[1].score = 0.3; // c_13
    s.concepts[2].score = 0.5; // c_14, ties with c_15
    const o = run(s, "okay");
    expect(o.move.conceptId).toBe("c_14");
    expect(o.move.level).toBe("L2");
  });

  it("asks the next unasked concept in deck order when nothing is struggling", () => {
    const o = run(freshSession(defs), "Binary search finds things in a sorted list.", {
      judge: { covered: [{ conceptId: "c_13", quote: "Binary search finds things" }] },
    });
    expect(o.move).toMatchObject({ kind: "question", level: "L0", conceptId: "c_12" });
    expect(o.move.line).toBe("Does binary search work on any list?");
  });

  it("does not touch the session it was given", () => {
    const s = sessionAt("c_14");
    const before = JSON.stringify(s);
    run(s, "I don't know");
    expect(JSON.stringify(s)).toBe(before);
  });

  it("counts every duck move on a concept, the opening check question included", () => {
    const o = run(freshSession(defs), "Binary search finds things in a sorted list.", {
      judge: { covered: [{ conceptId: "c_13", quote: "Binary search finds things" }] },
    });
    expect(stateOf(o, "c_12").moves).toBe(1);
  });
});

describe("evidence rules", () => {
  it("counts 'missed' only on the explanation turn", () => {
    const o = run(sessionAt("c_14"), "something", { judge: { missed: [{ conceptId: "c_15" }] } });
    expect(stateOf(o, "c_15").score).toBe(0);
  });

  it("ignores a 'covered' item whose quote is not in the turn", () => {
    const o = run(sessionAt("c_14"), "I think it stops at the end", {
      judge: { covered: [{ conceptId: "c_14", quote: "when nothing is left" }] },
    });
    expect(stateOf(o, "c_14").state).toBe("not_yet");
  });

  it("gives a concept the student explains unprompted the Owned state and never asks it", () => {
    let o = run(sessionAt("c_14"), "also it takes about twenty checks for a million", {
      judge: { covered: [{ conceptId: "c_16", quote: "about twenty checks" }] },
    });
    expect(stateOf(o, "c_16")).toMatchObject({ state: "owned", moves: 0 });
    // Run the rest of the session and make sure c_16 is never the target.
    for (let i = 0; i < 6; i++) {
      o = run(o.session, "hmm");
      expect(o.move.conceptId === "c_16" && o.move.kind !== "wrap_up").toBe(false);
    }
  });

  it("does not let a correct but vague answer resolve the concept", () => {
    const o = run(sessionAt("c_14"), "it just works", {
      judge: {
        covered: [{ conceptId: "c_14", quote: "it just works" }],
        vague: [{ conceptId: "c_14", quote: "it just works" }],
      },
    });
    expect(stateOf(o, "c_14").state).toBe("not_yet");
    expect(stateOf(o, "c_14").score).toBe(DUCK.weights.vague);
  });

  it("applies hedging and 'I don't know' to the concept the duck asked about", () => {
    const o = run(sessionAt("c_14"), "I don't know");
    expect(o.signals).toEqual(["dontKnow"]);
    expect(stateOf(o, "c_14").score).toBe(DUCK.weights.dontKnow);
    expect(o.move).toMatchObject({ level: "L2", conceptId: "c_14" });
  });

  it("does not spread text signals to concepts the duck did not ask about", () => {
    const o = run(sessionAt("c_14"), "I don't know");
    expect(stateOf(o, "c_15").score).toBe(0);
  });

  it("says nothing about a concept with no sign of struggle and moves on", () => {
    const o = run(sessionAt("c_14"), "it stops when it runs out of places to look");
    expect(o.move.conceptId).toBe("c_12"); // next unasked concept in deck order
    expect(o.move.level).toBe("L0");
  });
});

describe("the ladder in a session", () => {
  it("starts a request for help at L3, never L4, and does not count it as an attempt", () => {
    const o = run(sessionAt("c_14"), "Can you explain it?");
    expect(o.move).toMatchObject({ kind: "question", level: "L3", conceptId: "c_14" });
    expect(o.move.line).toBe(line("c_14", "L3"));
    expect(stateOf(o, "c_14").failedAttempts).toBe(0);
  });

  it("never opens a concept at L4, even with a score of 1", () => {
    const s = freshSession(defs);
    s.turnCount = 1;
    s.concepts[0].score = 1;
    const o = run(s, "okay");
    expect(o.move).toMatchObject({ conceptId: "c_12", level: "L3" });
  });

  it("climbs L1, L2, L3, then L4 as the final move, then offers to move on (an open prompt breaks up the questions)", () => {
    // Explanation turn: only sorted input is missed -> L1.
    let o = run(freshSession(defs), "Binary search is about lists.", {
      judge: {
        covered: [{ conceptId: "c_13", quote: "Binary search is about lists" }],
        missed: [{ conceptId: "c_12" }],
      },
    });
    const seen = [o.move];
    // Five more turns that do not resolve it and show no new signals.
    for (let i = 0; i < 5; i++) {
      o = run(o.session, "the list thing");
      seen.push(o.move);
    }
    // After two questions in a row the third move is the open prompt (spec section 5); it does not use up a ladder move.
    expect(seen.map((m) => m.kind)).toEqual(["question", "question", "open", "question", "question", "offer_skip"]);
    expect(seen.map((m) => m.level)).toEqual(["L1", "L2", "L2", "L3", "L4", "L4"]);
    expect(seen[4].line).toBe(line("c_12", "L4"));
    expect(seen[5].line).toBe(offerSkipLine(defs.find((d) => d.id === seen[5].conceptId)?.slide));
    expect(seen[5].line).toMatch(/come back/);
    expect(seen[5].line).not.toMatch(/slide/i);
    expect(stateOf(o, "c_12")).toMatchObject({ levelReached: "L4", failedAttempts: 5 });
  });

  it("offers to move on after the move cap when L4 is not earned", () => {
    const s = sessionAt("c_12", { score: 0.3, levelReached: "L3", moves: DUCK.maxMovesPerConcept, failedAttempts: 1 });
    const o = run(s, "the list thing");
    expect(o.move.kind).toBe("offer_skip");
    expect(o.move.conceptId).toBe("c_12");
  });

  it("uses a rephrase when the level cannot climb", () => {
    const s = sessionAt("c_12", { score: 0.3, levelReached: "L3", moves: 2, failedAttempts: 1 });
    const o = run(s, "the list thing");
    expect(o.move).toMatchObject({ kind: "rephrase", level: "L3" });
  });

  it("ends as Explained to after L4, with a neutral acknowledgement and no celebration", () => {
    const s = sessionAt("c_12", { score: 0.3, levelReached: "L4", moves: 4, failedAttempts: 3 });
    const o = run(s, "it only works sorted so you can throw half away", {
      judge: { covered: [{ conceptId: "c_12", quote: "only works sorted" }] },
    });
    expect(stateOf(o, "c_12").state).toBe("explained_to");
    expect(o.move).toMatchObject({ kind: "ack", line: "Okay, that makes sense now." });
    expect(o.move.then?.kind).toBe("question");
  });

  it("reads the move cap from the config", () => {
    const s = sessionAt("c_12", { score: 0.3, levelReached: "L1", moves: 1, failedAttempts: 0 });
    const o = run(s, "the list thing", {}, { ...DUCK, maxMovesPerConcept: 1 });
    expect(o.move.kind).toBe("offer_skip");
  });
});

describe("move on", () => {
  it("skips the concept the duck asked about and never raises it again", () => {
    let o = run(sessionAt("c_14"), "Let's move on");
    expect(stateOf(o, "c_14")).toMatchObject({ state: "skipped", skipped: true });
    expect(o.move).toMatchObject({ kind: "ack", line: "Okay." });
    expect(o.move.then?.conceptId).toBe("c_12");
    for (let i = 0; i < 6; i++) {
      o = run(o.session, "hmm");
      expect(o.move.conceptId === "c_14" && o.move.kind !== "wrap_up").toBe(false);
    }
  });

  it("does not skip while the student is explaining", () => {
    const o = run(sessionAt("c_14"), "then you skip the left half");
    expect(stateOf(o, "c_14").state).toBe("not_yet");
    expect(stateOf(o, "c_14").skipped).toBe(false);
  });

  it("treats a plain 'yes' as a skip only right after the duck offers one", () => {
    const afterQuestion = run(sessionAt("c_14"), "yes");
    expect(stateOf(afterQuestion, "c_14").skipped).toBe(false);

    const offered = sessionAt("c_14", { levelReached: "L4" });
    offered.lastMoveKind = "offer_skip";
    const o = run(offered, "yes");
    expect(stateOf(o, "c_14")).toMatchObject({ state: "skipped", skipped: true });
  });

  it("keeps going if the student answers instead of agreeing to skip", () => {
    const offered = sessionAt("c_14", { levelReached: "L4", score: 0.5 });
    offered.lastMoveKind = "offer_skip";
    const o = run(offered, "it stops when nothing is left", {
      judge: { covered: [{ conceptId: "c_14", quote: "nothing is left" }] },
    });
    expect(stateOf(o, "c_14").state).toBe("explained_to");
  });
});

describe("every line respects the duck's limits", () => {
  it("holds for each precomputed line and check question, with and without an acknowledgement", () => {
    const acks = [undefined, "Got it.", "Okay, that makes sense now.", "Okay."];
    for (const d of defs) {
      const lines = [d.checkPrompt!, ...Object.values(d.fallbackQuestions)];
      for (const l of lines) {
        for (const ack of acks) {
          const spoken = withAck(ack, l);
          expect(wordCount(spoken)).toBeLessThanOrEqual(DUCK.maxDuckWords);
          expect((spoken.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("drops the acknowledgement rather than go over the word limit", () => {
    const long = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen?";
    expect(wordCount(long)).toBe(19);
    expect(withAck("Got it.", long)).toBe(long);
    expect(withAck("Hi.", "a b c")).toBe("Hi. a b c");
  });
});
