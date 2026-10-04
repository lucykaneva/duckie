import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import type { DuckMove, JudgeResult } from "../src/lib/duck/types";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import {
  compareAnswer,
  findLeak,
  normalizeAnswer,
  numberRuns,
  numbersIn,
  parseExpected,
} from "../src/lib/engine/answers";
import { committedAnswer } from "../src/lib/engine/commit";
import { guardMove } from "../src/lib/engine/guard";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { LEAK_FALLBACK_LINE, wordCount } from "../src/lib/engine/wording";
import { verifySecrets } from "../src/lib/extract/extract-concepts";
import type { ExtractedConcept } from "../src/lib/extract/validate";

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

const trace = SEED_CONCEPTS.find((c) => c.id === "c_14")!;
const ANSWER = "[5,7]";
const answers = [{ conceptId: "c_14", expectedAnswer: ANSWER }];
const judge = (parts: Partial<JudgeResult> = {}): JudgeResult => ({ ...emptyJudgeResult(), ...parts });

describe("reading numbers out of speech", () => {
  it("finds digits in the order spoken", () => {
    expect(numbersIn("Um, I think 5, then 7, then maybe 9?")).toEqual([5, 7, 9]);
    expect(numbersIn("5,7")).toEqual([5, 7]);
    expect(numbersIn("about 1,000 items, or -3.5")).toEqual([1000, -3.5]);
  });

  it("reads spoken numbers", () => {
    expect(numbersIn("about twenty")).toEqual([20]);
    expect(numbersIn("twenty-five")).toEqual([25]);
    expect(numbersIn("twenty five then ninety nine")).toEqual([25, 99]);
    expect(numbersIn("one hundred and five")).toEqual([100, 5]);
    expect(numbersIn("a million")).toEqual([1_000_000]);
    expect(numbersIn("five and seven")).toEqual([5, 7]);
  });

  it("does not read a pronoun 'one' as a number", () => {
    expect(numbersIn("that one is the right one")).toEqual([]);
    expect(numbersIn("one, two and three")).toEqual([1, 2, 3]);
  });

  it("ignores page references", () => {
    expect(numbersIn("Slide 7 shows it. Check page 12.")).toEqual([]);
  });

  it("groups numbers joined by 'and', 'then' and commas into runs", () => {
    expect(numberRuns("Test me: 1, 3, 5, 7, 9, looking for 6.")).toEqual([[1, 3, 5, 7, 9], [6]]);
    expect(numberRuns("You check 5 and 7, so it stops")).toEqual([[5, 7]]);
    expect(numberRuns("5, then 7")).toEqual([[5, 7]]);
    expect(numberRuns("5 or maybe 7")).toEqual([[5], [7]]);
  });
});

describe("stored answers", () => {
  it("accepts numbers, lists, words and booleans, and nothing else", () => {
    expect(normalizeAnswer("[5, 7]")).toBe("[5,7]");
    expect(normalizeAnswer(" 20 ")).toBe("20");
    expect(normalizeAnswer('"middle"')).toBe('"middle"');
    expect(normalizeAnswer("true")).toBe("true");
    expect(normalizeAnswer('["a","b"]')).toBe('["a","b"]');
    for (const bad of ["{}", "[]", "[1,\"a\"]", "[[1]]", "null", "NaN", "", '""', "not json"]) {
      expect(normalizeAnswer(bad), bad).toBeNull();
    }
    expect(parseExpected("[5,7]")).toEqual({ kind: "numbers", values: [5, 7] });
  });
});

describe("comparing the student's answer", () => {
  it("is correct for the worked example's right answers", () => {
    expect(compareAnswer("5 then 7", ANSWER)).toBe("correct");
    // Spec turn 5: repeats 7 while explaining, still the right answer.
    expect(compareAnswer("When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.", ANSWER)).toBe(
      "correct",
    );
    expect(compareAnswer("five and then seven", ANSWER)).toBe("correct");
    expect(compareAnswer("[5, 7]", ANSWER)).toBe("correct");
    expect(
      compareAnswer(
        "So first you check 5, then you check 7, and then you see that you update the low and the high based on the 7, and then you see that low will equal to high, and you will not have found 6, so then you will return, you will end the loop and just say that 6 is not in the list.",
        ANSWER,
      ),
    ).toBe("correct");
  });

  it("is wrong for the worked example's wrong answer (spec turn 4)", () => {
    expect(compareAnswer("Um, I think 5, then 7, then maybe 9?", ANSWER)).toBe("wrong");
  });

  it("is wrong when a value is missing, extra, or in the wrong order", () => {
    expect(compareAnswer("just 5", ANSWER)).toBe("wrong");
    expect(compareAnswer("5, 7 and 9", ANSWER)).toBe("wrong");
    expect(compareAnswer("7 then 5", ANSWER)).toBe("wrong");
    expect(compareAnswer("3", ANSWER)).toBe("wrong");
  });

  it("does not judge when the student gives no number", () => {
    expect(compareAnswer("I don't know", ANSWER)).toBe("none");
    expect(compareAnswer("Can you explain it?", ANSWER)).toBe("none");
    expect(compareAnswer("let's move on", ANSWER)).toBe("none");
    expect(compareAnswer("Slide 7 maybe?", ANSWER)).toBe("none");
  });

  it("compares a single number", () => {
    expect(compareAnswer("About twenty.", "20")).toBe("correct");
    expect(compareAnswer("around 20 steps", "20")).toBe("correct");
    expect(compareAnswer("about a thousand", "20")).toBe("wrong");
  });

  it("compares words without ever marking a miss as wrong", () => {
    expect(compareAnswer("It returns the middle one.", '"middle"')).toBe("correct");
    expect(compareAnswer("It returns the centre.", '"middle"')).toBe("none");
    expect(compareAnswer("first then last", '["first","last"]')).toBe("correct");
    expect(compareAnswer("last then first", '["first","last"]')).toBe("none");
  });

  it("compares true and false", () => {
    expect(compareAnswer("Yes, it stops.", "true")).toBe("correct");
    expect(compareAnswer("No it loops forever", "true")).toBe("wrong");
    expect(compareAnswer("no idea", "true")).toBe("none");
    expect(compareAnswer("it does not stop", "true")).toBe("none");
  });

  it("returns none for a stored answer it cannot read", () => {
    expect(compareAnswer("5 and 7", "{bad")).toBe("none");
  });
});

describe("the leak check", () => {
  const given = trace.checkPrompt;

  it("blocks the worked example's leak: the duck saying '5 and 7'", () => {
    for (const line of [
      "So you'd check 5 and 7, right?",
      "Is it 5, then 7?",
      "You check five and then seven, don't you?",
      "After checking 5, 7, what happens?",
      "The answer is [5, 7]. Do you agree?",
    ]) {
      expect(findLeak(line, [{ expectedAnswer: ANSWER, givenText: given }]), line).toBe(ANSWER);
    }
  });

  it("allows the question's own list, which contains 5 and 7 in order", () => {
    expect(findLeak(trace.checkPrompt, [{ expectedAnswer: ANSWER }])).toBeNull();
    expect(findLeak(`Got it. ${trace.checkPrompt}`, [{ expectedAnswer: ANSWER, givenText: given }])).toBeNull();
  });

  it("allows every precomputed line of the seed's trace concept", () => {
    for (const line of Object.values(trace.fallbackQuestions)) {
      expect(findLeak(line, [{ expectedAnswer: ANSWER, givenText: given }]), line).toBeNull();
    }
  });

  it("allows 'Slide 7', a page and not a value", () => {
    expect(findLeak("Slide 7 shows when it stops. What has to be true to stop?", [{ expectedAnswer: "7" }])).toBeNull();
  });

  it("allows a number that only appears alongside other values", () => {
    expect(findLeak("Try the list 2, 4 looking for 3. When do you stop?", [{ expectedAnswer: ANSWER }])).toBeNull();
    expect(findLeak("Which of 5, 7 and 9 do you look at first?", [{ expectedAnswer: ANSWER }])).toBeNull();
  });

  it("blocks a single-number answer said on its own", () => {
    expect(findLeak("So that's about twenty checks, right?", [{ expectedAnswer: "20" }])).toBe("20");
    expect(findLeak("How many checks for a million items?", [{ expectedAnswer: "20" }])).toBeNull();
  });

  it("blocks a stored word or phrase, unless the question already says it", () => {
    expect(findLeak("Does it return the middle?", [{ expectedAnswer: '"middle"' }])).toBe('"middle"');
    expect(
      findLeak("Which one is the middle?", [{ expectedAnswer: '"middle"', givenText: "Which one is the middle?" }]),
    ).toBeNull();
    expect(findLeak("What does it return?", [{ expectedAnswer: '"middle"' }])).toBeNull();
  });

  it("never checks true and false answers", () => {
    expect(findLeak("Yes or no, does it stop?", [{ expectedAnswer: "true" }])).toBeNull();
  });
});

describe("guarding the duck's line", () => {
  const move = (line: string, over: Partial<DuckMove> = {}): DuckMove => ({
    kind: "question",
    level: "L2",
    conceptId: "c_14",
    line,
    sessionState: "active",
    concepts: [],
    ...over,
  });

  it("replaces a leaking line with the concept's own precomputed line for that level", () => {
    const out = guardMove(move("So you'd check 5 and 7, right?"), defs, answers, []);
    expect(out.blocked).toEqual(["c_14"]);
    expect(out.move.line).toBe(trace.fallbackQuestions.L2);
  });

  it("falls back to a neutral line when there is no safe precomputed line", () => {
    const out = guardMove(move("You'd check 5 and 7, right?", { level: "L0" }), defs, answers, []);
    expect(out.move.line).toBe(LEAK_FALLBACK_LINE);
    expect(wordCount(out.move.line)).toBeLessThanOrEqual(DUCK.maxDuckWords);
    expect((out.move.line.match(/\?/g) ?? []).length).toBe(1);
  });

  it("also guards the follow-up after a celebration", () => {
    const out = guardMove(
      move("Ooh, nice.", { kind: "celebrate", then: move("Is it 5 and 7?", { level: "L0" }) }),
      defs,
      answers,
      [],
    );
    expect(out.move.then!.line).toBe(LEAK_FALLBACK_LINE);
  });

  it("lets the check question and the precomputed lines through", () => {
    for (const line of [trace.checkPrompt, ...Object.values(trace.fallbackQuestions)]) {
      const out = guardMove(move(line, { level: "L0" }), defs, answers, []);
      expect(out.blocked).toEqual([]);
      expect(out.move.line).toBe(line);
    }
  });

  it("lets the answer be said once the student has committed to one", () => {
    const out = guardMove(move("So you checked 5 and 7."), defs, answers, ["c_14"]);
    expect(out.blocked).toEqual([]);
    expect(out.move.line).toBe("So you checked 5 and 7.");
  });
});

describe("committing an answer", () => {
  function sessionAt(id: string, overrides: Partial<SessionRun["concepts"][number]> = {}): SessionRun {
    const s = freshSession(defs);
    s.turnCount = 2;
    s.focusConceptId = id;
    s.lastMoveKind = "question";
    Object.assign(s.concepts.find((c) => c.conceptId === id)!, { moves: 1 }, overrides);
    return s;
  }

  it("compares only trace and prediction concepts that are open", () => {
    expect(committedAnswer("5 then 7", sessionAt("c_14"), defs, answers)).toEqual({ conceptId: "c_14", correct: true });
    expect(committedAnswer("5 then 9", sessionAt("c_14"), defs, answers)).toEqual({ conceptId: "c_14", correct: false });
    expect(committedAnswer("I don't know", sessionAt("c_14"), defs, answers)).toBeUndefined();
    // They answered the trace while the duck was on another idea. That trace is the turn.
    expect(committedAnswer("5 then 7", sessionAt("c_12"), defs, answers)).toEqual({ conceptId: "c_14", correct: true });
    expect(committedAnswer("about twenty", sessionAt("c_12"), defs, answers)).toBeUndefined();
    expect(committedAnswer("5 then 7", sessionAt("c_14", { state: "assisted" }), defs, answers)).toBeUndefined();
    expect(committedAnswer("5 then 7", sessionAt("c_14", { skipped: true, state: "skipped" }), defs, answers)).toBeUndefined();
  });

  it("does not compare the reply to the L3 example, which uses different values", () => {
    expect(committedAnswer("2 then 4", sessionAt("c_14", { levelReached: "L3" }), defs, answers)).toBeUndefined();
    expect(committedAnswer("2 then 4", sessionAt("c_14", { levelReached: "L2" }), defs, answers)).toEqual({
      conceptId: "c_14",
      correct: false,
    });
  });

  it("replays the worked example's trace turns end to end", () => {
    // The duck has just asked the trace question.
    let s = sessionAt("c_14");
    // Spec turn 4: wrong trace plus hedging = 0.45, so L2.
    const wrongText = "Um, I think 5, then 7, then maybe 9?";
    let o = processTurn(defs, s, {
      text: wrongText,
      judge: judge(),
      answer: committedAnswer(wrongText, s, defs, answers),
    });
    expect(o.signals).toEqual(["wrongTrace", "hedging"]);
    expect(o.scoreAfter).toBe(0.45);
    expect(o.move).toMatchObject({ level: "L2", line: trace.fallbackQuestions.L2 });
    expect(o.session.committed).toEqual(["c_14"]);
    // The duck never says "5 and 7" in that line.
    expect(guardMove(o.move, defs, answers, []).blocked).toEqual([]);

    // Spec turn 5: right answer, resolved, earned.
    s = o.session;
    const rightText = "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.";
    o = processTurn(defs, s, {
      text: rightText,
      judge: judge(),
      answer: committedAnswer(rightText, s, defs, answers),
    });
    expect(o.session.concepts.find((c) => c.conceptId === "c_14")).toMatchObject({ state: "assisted", score: 0 });
    expect(o.resolved[0].previous).toBeGreaterThanOrEqual(DUCK.earnedScore);
    expect(o.move.kind).toBe("celebrate");
  });

  it("checks a guess of 3 against the list and stays on that idea", () => {
    const prompt = trace.checkPrompt!;
    const first = "Okay so, I guess like we would start at 3?";
    expect(compareAnswer(first, ANSWER)).toBe("wrong");
    let s = sessionAt("c_14");
    s.lastLine = prompt;
    let o = processTurn(defs, s, {
      text: first,
      judge: judge(),
      answer: committedAnswer(first, s, defs, answers),
    });
    expect(o.move.conceptId).toBe("c_14");
    expect(o.move.level).toBe("L1");
    expect(o.scoreAfter).toBe(0.3);
    expect(o.move.line).toBe(trace.fallbackQuestions.L1);
    expect(o.move.line).not.toMatch(/that's wrong|pebble/i);
    expect(findLeak(o.move.line, [{ expectedAnswer: ANSWER, givenText: prompt }])).toBeNull();

    s = o.session;
    const second =
      "We start in the middle at 3. 3, is it really the middle? Can you look at that list and see if it's the middle?";
    expect(committedAnswer(second, s, defs, answers)).toEqual({ conceptId: "c_14", correct: false });
    o = processTurn(defs, s, {
      text: second,
      judge: judge(),
      answer: committedAnswer(second, s, defs, answers),
    });
    expect(o.move.conceptId).toBe("c_14");
    expect(o.move.kind).not.toBe("celebrate");
    expect(o.session.concepts.find((c) => c.conceptId === "c_14")?.state).toBe("not_yet");
    expect(o.scoreAfter).toBe(0.6);
    expect(o.move.level).toBe("L2");
    expect(findLeak(o.move.line, [{ expectedAnswer: ANSWER, givenText: prompt }])).toBeNull();

    s = o.session;
    const third = "Okay, five. Then what do I check?";
    expect(committedAnswer(third, s, defs, answers)).toBeUndefined();
    o = processTurn(defs, s, {
      text: third,
      judge: judge(),
      answer: committedAnswer(third, s, defs, answers),
    });
    expect(o.move.conceptId).toBe("c_14");
    expect(o.move.kind).not.toBe("celebrate");
    expect(o.move.line).not.toBe("How does it find things so fast?");
    expect(o.move.line).not.toBe("Does binary search work on any list?");
    expect(o.session.concepts.find((c) => c.conceptId === "c_14")?.state).toBe("not_yet");
  });

  it("does not stack a judge misconception on the same wrong guess", () => {
    const first = "Okay so, I guess like we would start at 3?";
    const s = sessionAt("c_14");
    s.lastLine = trace.checkPrompt!;
    const o = processTurn(defs, s, {
      text: first,
      judge: judge({ misconceptions: [{ conceptId: "c_14", quote: "we would start at 3" }] }),
      answer: committedAnswer(first, s, defs, answers),
    });
    expect(o.signals).toEqual(["wrongTrace"]);
    expect(o.scoreAfter).toBe(0.3);
    expect(o.move.level).toBe("L1");
    expect(o.move.conceptId).toBe("c_14");
  });

  it("a wrong trace on its own raises the score by 0.3", () => {
    const s = sessionAt("c_14");
    const text = "I check 3 and 9";
    const o = processTurn(defs, s, { text, judge: judge(), answer: committedAnswer(text, s, defs, answers) });
    expect(o.signals).toEqual(["wrongTrace"]);
    expect(o.scoreAfter).toBe(DUCK.weights.wrongTrace);
    expect(o.scoreAfter).toBe(0.3);
  });

  it("a second wrong trace climbs higher than the first", () => {
    let s = sessionAt("c_14");
    let o = processTurn(defs, s, { text: "3 and 9", judge: judge(), answer: committedAnswer("3 and 9", s, defs, answers) });
    s = o.session;
    o = processTurn(defs, s, { text: "1 and 9", judge: judge(), answer: committedAnswer("1 and 9", s, defs, answers) });
    expect(o.scoreAfter).toBe(0.6);
  });
});

describe("checking the code's answer against Grok's at upload", () => {
  const concept = (over: Partial<ExtractedConcept> = {}): ExtractedConcept => ({
    topic: trace.topic,
    name: trace.name,
    slide: trace.slide,
    kind: "trace",
    misconceptions: [],
    checkPrompt: trace.checkPrompt,
    plantsMisconception: false,
    fallbackQuestions: trace.fallbackQuestions,
    secret: { referenceCode: "return [5, 7];", expectedAnswer: "[5, 7]" },
    ...over,
  });

  it("stores what the code returned, not what Grok guessed", async () => {
    const { concepts, problems } = await verifySecrets([concept()], async () => ({ ok: true, json: "[5,7]" }));
    expect(concepts[0].secret).toEqual({ referenceCode: "return [5, 7];", expectedAnswer: "[5,7]" });
    expect(concepts[0].kind).toBe("trace");
    expect(problems).toEqual([]);

    const different = await verifySecrets([concept()], async () => ({ ok: true, json: "[5,7,9]" }));
    expect(different.concepts[0].secret!.expectedAnswer).toBe("[5,7,9]");
    expect(different.problems.join(" ")).toMatch(/Grok expected \[5, 7\], the code returned \[5,7,9\]/);
  });

  it("turns a concept whose code fails into a plain explain question", async () => {
    const { concepts, problems } = await verifySecrets([concept()], async () => ({
      ok: false,
      error: "the code took too long",
    }));
    expect(concepts[0].kind).toBe("explain");
    expect(concepts[0].secret).toBeUndefined();
    expect(problems.join(" ")).toMatch(/treated as explain/);
  });

  it("turns a concept whose lines say the real answer into a plain explain question", async () => {
    const leaky = concept({
      fallbackQuestions: { ...trace.fallbackQuestions, L3: "You'd check 5 and 7, right?" },
    });
    const { concepts, problems } = await verifySecrets([leaky], async () => ({ ok: true, json: "[5,7]" }));
    expect(concepts[0].kind).toBe("explain");
    expect(concepts[0].secret).toBeUndefined();
    expect(problems.join(" ")).toMatch(/says the real answer/);
  });

  it("leaves concepts without code alone and never calls the runner for them", async () => {
    let calls = 0;
    const plain = concept({ kind: "explain", secret: undefined });
    const { concepts } = await verifySecrets([plain], async () => {
      calls += 1;
      return { ok: true, json: "1" };
    });
    expect(concepts[0]).toEqual(plain);
    expect(calls).toBe(0);
  });
});
