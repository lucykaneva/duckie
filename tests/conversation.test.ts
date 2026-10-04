/**
 * A real session that went in circles, plus the situations the duck has to handle
 * without slides, lectures, or repeating itself.
 */
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { ENGINE } from "../src/lib/duck/config";
import { processSilence } from "../src/lib/engine/silence";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, openingMove, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { WAIT_LINE } from "../src/lib/engine/wording";

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

const say = (s: SessionRun, text: string) => processTurn(defs, s, { text, judge: emptyJudgeResult(), nowMs: 60_000 });

function spoken(line: string) {
  expect(line).not.toMatch(/walk me through|i'm just a duck|slide \d+|that's wrong|great job/i);
  expect((line.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
}

describe("the session that went in circles", () => {
  it("names the topic, then starts a small piece, and never asks the same thing again", () => {
    const open = openingMove(defs);
    expect(open.line).toBe("I don't really get binary search yet. How does it work?");
    spoken(open.line);

    let s = freshSession(defs);
    let o = say(s, "Hello, through what?");
    spoken(o.move.line);
    expect(o.move.line).not.toBe(open.line);
    expect(o.move.line.toLowerCase()).toContain("binary search");
    s = o.session;

    o = say(s, "Hm, I'm not really sure to be honest, I kinda forgot.");
    spoken(o.move.line);
    expect(o.move).toMatchObject({ kind: "question", level: "L1", conceptId: "c_12" });
    const firstPiece = o.move.line;
    s = o.session;

    const movesBefore = s.concepts.find((c) => c.conceptId === "c_12")!.moves;
    o = say(s, "Okay, let's do that.");
    spoken(o.move.line);
    expect(o.move.line).not.toBe(firstPiece);
    expect(o.move.line).not.toMatch(/let's try that/i);
    expect(o.move.level).toBe("L1");
    expect(o.session.concepts.find((c) => c.conceptId === "c_12")!.moves).toBe(movesBefore);
    expect(o.session.concepts.find((c) => c.conceptId === "c_12")!.score).toBe(0);
    s = o.session;

    o = say(
      s,
      "I don't really know, like I know it's about a list, but I don't really remember what binary search is.",
    );
    spoken(o.move.line);
    expect(o.move.line).not.toBe(s.lastLine);
    expect(o.move.kind).not.toBe("open");
    s = o.session;

    const before = s.lastLine;
    o = say(s, "Bro, I just said I don't remember. I know it's about a list.");
    spoken(o.move.line);
    expect(o.move.line).not.toBe(before);
    expect(o.move.kind).not.toBe("open");
  });
});

describe("other ways a conversation goes", () => {
  it("gives a hint when they say just tell me, before they have taught anything", () => {
    const o = say(freshSession(defs), "Just tell me.");
    expect(o.move).toMatchObject({ kind: "question", level: "L3", conceptId: "c_12" });
    spoken(o.move.line);
  });

  it("waits softly instead of asking again", () => {
    const started = say(freshSession(defs), "I forgot.").session;
    const quiet = processSilence(started, 1, 8_000);
    expect(quiet?.move.kind).toBe("wait");
    expect(quiet?.move.line).toBe(WAIT_LINE);
  });

  it("offers to stop when they ask, instead of another question", () => {
    const o = say(freshSession(defs), "Can we stop here?");
    expect(o.move.kind).toBe("wrap_up");
  });

  it("hears I'm tired as stopping the session, and does not skip the idea", () => {
    const started = say(freshSession(defs), "I forgot.").session;
    const o = say(started, "Is it like twenty checks? I don't know, I'm tired.");
    expect(o.move).toMatchObject({ kind: "check_in", line: "Want to keep going, or stop here?" });
    expect(o.session.pending).toBe("wrap_proposal");
    expect(o.session.concepts.every((c) => c.state !== "skipped")).toBe(true);
    expect(o.signals).toEqual([]);
  });
});

describe("a turn is only an attempt when they actually try", () => {
  it("stays on a wrong belief they volunteer, even if the duck asked something else", () => {
    let s = say(freshSession(defs), "I forgot.").session;
    s = { ...s, focusConceptId: "c_13", lastMoveKind: "question", lastLine: "How does it find things so fast?" };
    const o = say(s, "Yeah lo equals mid is fine, right?");
    expect(o.session.concepts.find((c) => c.conceptId === "c_15")!.state).toBe("misconception");
    expect(o.move.conceptId).toBe("c_15");
    expect(o.move.line.toLowerCase()).not.toMatch(/search space|that's wrong/);
    expect(o.session.concepts.find((c) => c.conceptId === "c_13")!.failedAttempts).toBe(0);
  });

  it("celebrates when they catch the planted mistake themselves", () => {
    const s = freshSession(defs);
    s.focusConceptId = "c_15";
    s.lastMoveKind = "question";
    s.lastLine = "My friend wrote lo = mid, not mid + 1. Is that okay?";
    s.concepts.find((c) => c.conceptId === "c_15")!.moves = 1;
    const o = say(s, "Wait, it stays the same so it loops forever.");
    expect(o.session.concepts.find((c) => c.conceptId === "c_15")!.state).toBe("owned");
    expect(o.move.kind).toBe("celebrate");
    expect(o.move.line).toMatch(/caught|explained/i);
    expect(o.move.line).not.toMatch(/\?/);
  });

  it("does not mark a correct explanation wrong, or climb, when the judge mislabels it", () => {
    const s = say(freshSession(defs), "I forgot.").session;
    const before = s.concepts.find((c) => c.conceptId === "c_12")!;
    const text = "If the list isn't in order you might throw away the half that has the number.";
    const o = processTurn(defs, s, {
      text,
      nowMs: 60_000,
      judge: {
        ...emptyJudgeResult(),
        misconceptions: [{ conceptId: "c_12", quote: "throw away the half that has the number" }],
      },
    });
    const after = o.session.concepts.find((c) => c.conceptId === "c_12")!;
    expect(after.state).not.toBe("misconception");
    expect(after.levelReached).toBe(before.levelReached);
    expect(o.move.kind).toBe("open");
    expect(o.move.line).not.toMatch(/say that back|that's wrong/i);
    expect(o.signals).not.toContain("misconception");
    expect(after.state).toBe("not_yet");
  });

  it("counts that explanation once the duck has already nudged the idea, even if the judge misses it", () => {
    const s = say(freshSession(defs), "I forgot.").session;
    const concept = s.concepts.find((c) => c.conceptId === "c_12")!;
    concept.levelReached = "L3";
    concept.score = 0.45;
    concept.moves = 3;
    const text = "If the list isn't in order you might throw away the half that has the number.";
    const o = processTurn(defs, s, {
      text,
      nowMs: 60_000,
      judge: {
        ...emptyJudgeResult(),
        misconceptions: [{ conceptId: "c_12", quote: "throw away the half that has the number" }],
      },
    });
    const after = o.session.concepts.find((c) => c.conceptId === "c_12")!;
    expect(after.state).toBe("assisted");
    expect(after.score).toBe(0);
    expect(o.move.kind).toBe("celebrate");
    expect(o.move.line).not.toMatch(/\?/);
    expect(o.signals).not.toContain("misconception");
  });

  it("does not count the focus idea when this turn clearly taught a different one", () => {
    const s = say(freshSession(defs), "I forgot.").session;
    const concept = s.concepts.find((c) => c.conceptId === "c_12")!;
    concept.levelReached = "L2";
    concept.moves = 2;
    const text = "You start in the middle. If the number is bigger you go right.";
    const o = processTurn(defs, s, {
      text,
      nowMs: 60_000,
      judge: {
        ...emptyJudgeResult(),
        covered: [{ conceptId: "c_13", quote: "start in the middle" }],
      },
    });
    expect(o.session.concepts.find((c) => c.conceptId === "c_12")!.state).toBe("not_yet");
    expect(o.session.concepts.find((c) => c.conceptId === "c_13")!.state).toBe("owned");
  });

  it("names a correct explanation before it asks the next thing", () => {
    let s = say(freshSession(defs), "I forgot.").session;
    s = say(s, "I don't know. I know it's a list.").session;
    const text = "If the list isn't in order you might throw away the half that has the number.";
    const o = processTurn(defs, s, {
      text,
      nowMs: 60_000,
      judge: {
        ...emptyJudgeResult(),
        covered: [{ conceptId: "c_12", quote: "list isn't in order" }],
      },
    });
    expect(o.move.kind).toBe("celebrate");
    expect(o.move.line).not.toMatch(/\?/);
    expect(o.move.line).not.toMatch(/how does it find/i);
    expect(o.move.then?.line).toBeTruthy();
  });

  it("does not accept a right opening when the ending states a different method", () => {
    const s = say(freshSession(defs), "I forgot.").session;
    const concept = s.concepts.find((c) => c.conceptId === "c_12")!;
    concept.levelReached = "L2";
    concept.score = 0.45;
    concept.moves = 2;
    s.focusConceptId = "c_12";
    s.lastMoveKind = "question";
    s.lastLine = "What makes sorted order matter for the search?";
    const text =
      "I can halve it into maybe? If it's in order I can search the elements one by one actually, and then if I get to an element that's bigger I stop looking because every other element afterwards is bigger.";
    const o = processTurn(defs, s, {
      text,
      nowMs: 60_000,
      judge: {
        ...emptyJudgeResult(),
        covered: [{ conceptId: "c_12", quote: "I can halve it" }],
        misconceptions: [{ conceptId: "c_12", quote: "search the elements one by one" }],
      },
    });
    const after = o.session.concepts.find((c) => c.conceptId === "c_12")!;
    expect(o.signals).toContain("misconception");
    expect(after.state).not.toBe("assisted");
    expect(after.state).not.toBe("owned");
    expect(o.move.kind).not.toBe("ack");
    expect(o.move.kind).not.toBe("celebrate");
    expect(o.move.conceptId).toBe("c_12");
  });
});
