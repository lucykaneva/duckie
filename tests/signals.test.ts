import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import {
  countFillers,
  countHedges,
  countWords,
  detectDontKnow,
  detectHedging,
  detectHeavyFillers,
  detectHelpRequest,
  detectMoveOn,
  detectTextSignals,
} from "../src/lib/engine/signals";

describe("I don't know", () => {
  it.each([
    "I don't know",
    "I dont know how it stops",
    "I don’t know", // curly apostrophe from a transcript
    "I do not know",
    "No idea",
    "I have no idea what that means",
    "Not sure at all",
    "I dunno",
    "no clue",
  ])("fires on %j", (text) => {
    expect(detectDontKnow(text)).toBe(true);
  });

  it.each([
    "I know it halves the list",
    "I do know this one",
    "It is well known",
    "I'm not sure",
    "",
  ])("does not fire on %j", (text) => {
    expect(detectDontKnow(text)).toBe(false);
  });
});

describe("hedging", () => {
  it("counts every hedge phrase, case-insensitively", () => {
    expect(countHedges("I think maybe it is kind of fast or something")).toBe(4);
    expect(countHedges("MAYBE")).toBe(1);
    expect(countHedges("It's kinda sorted")).toBe(1);
  });

  it("needs DUCK.hedgingMinPerTurn (2) hedges in one turn", () => {
    expect(DUCK.hedgingMinPerTurn).toBe(2);
    expect(detectHedging("I think it halves")).toBe(false);
    expect(detectHedging("I think it halves, maybe")).toBe(true);
    expect(detectHedging("I think so. I think.")).toBe(true);
  });

  it("matches whole phrases only", () => {
    expect(countHedges("I thinking about it")).toBe(0);
    expect(countHedges("a mayberry bush")).toBe(0);
  });

  it("reads the threshold from the config passed in", () => {
    const strict = { hedgingMinPerTurn: 1, fillerWordsPerUm: DUCK.fillerWordsPerUm };
    expect(detectHedging("I think it halves", strict)).toBe(true);
  });
});

describe("fillers: only um and uh", () => {
  it("counts um and uh, including stretched and alternate spellings", () => {
    expect(countFillers("um")).toBe(1);
    expect(countFillers("Uh, so, um...")).toBe(2);
    expect(countFillers("ummm and uhhh")).toBe(2);
    expect(countFillers("uhm")).toBe(1);
  });

  it("does not count other filler-ish words", () => {
    // Spec fillers are "um" and "uh" only. "like", "so", "and" just extend the turn wait.
    expect(countFillers("like, you know, so, and, er, hmm")).toBe(0);
  });

  it("matches whole words, not letters inside other words", () => {
    expect(countFillers("an umbrella, a hum, Uhura, the sum")).toBe(0);
  });

  it("does not count uh-huh or uh-oh", () => {
    expect(countFillers("uh-huh")).toBe(0);
    expect(countFillers("uh huh, yes")).toBe(0);
    expect(countFillers("uh-oh")).toBe(0);
    expect(countFillers("uh uh I think")).toBe(2);
    expect(countFillers("uh-huh, um, yes")).toBe(1);
  });

  it("counts words the same way a transcript reads", () => {
    expect(countWords("Um, I think 5, then 7, then maybe 9?")).toBe(9);
    expect(countWords("")).toBe(0);
    expect(countWords("It’s the middle")).toBe(3);
  });

  it("is heavy only above 1 per 8 words", () => {
    expect(DUCK.fillerWordsPerUm).toBe(8);
    // 1 filler in 7 words: 1/7 > 1/8
    expect(detectHeavyFillers("um it halves the list each time")).toBe(true);
    // 1 filler in exactly 8 words: 1/8 is not more than 1/8
    expect(detectHeavyFillers("um it halves the list each time ok")).toBe(false);
    // 2 fillers in 16 words: exactly 1 per 8, not more
    expect(
      detectHeavyFillers("um it halves the list each time ok and then uh it looks at one more place"),
    ).toBe(false);
    // 3 fillers in 7 words
    expect(detectHeavyFillers("um uh so like um I mean")).toBe(true);
  });

  it("is not heavy with no fillers or no words", () => {
    expect(detectHeavyFillers("")).toBe(false);
    expect(detectHeavyFillers("it halves the list")).toBe(false);
  });

  it("reads the rate from the config passed in", () => {
    const tight = { hedgingMinPerTurn: 2, fillerWordsPerUm: 12 };
    expect(detectHeavyFillers("um it halves the list each time ok", tight)).toBe(true);
  });
});

describe("move on", () => {
  it.each([
    "Let's move on",
    "lets move on",
    "Can we skip this one?",
    "I want to skip this",
    "Please skip",
    "Skip.",
    "Move on",
    "Okay, next",
    "skip that",
  ])("fires on %j", (text) => {
    expect(detectMoveOn(text)).toBe(true);
  });

  it.each([
    "Then you skip the left half",
    "If it's too big you skip everything above mid",
    "It moves on to the right half",
    "Then it will move on to the next element",
    "",
  ])("does not fire while explaining: %j", (text) => {
    expect(detectMoveOn(text)).toBe(false);
  });
});

describe("asking for help is not a struggle signal", () => {
  it.each([
    "Can you explain it?",
    "Could you help me with this?",
    "Please explain",
    "Can you give me a hint",
    "I need some help",
    "I'm stuck",
    "explain it to me",
  ])("%j is a help request", (text) => {
    expect(detectHelpRequest(text)).toBe(true);
    expect(detectTextSignals(text)).toEqual([]);
  });

  it("does not read the student teaching as a request", () => {
    expect(detectHelpRequest("Let me explain it: you halve the list")).toBe(false);
    expect(detectHelpRequest("It helps to sort first")).toBe(false);
  });
});

describe("detectTextSignals", () => {
  it("returns the code-detected signals in the spec's order", () => {
    expect(detectTextSignals("Um, I think, maybe, I don't know")).toEqual([
      "dontKnow",
      "hedging",
      "fillers",
    ]);
  });

  it("returns each signal once even if it repeats", () => {
    expect(detectTextSignals("I don't know, no idea, I dunno")).toEqual(["dontKnow"]);
  });

  it("is empty for a clean explanation", () => {
    expect(detectTextSignals("You look at the middle and keep halving the list")).toEqual([]);
  });
});
