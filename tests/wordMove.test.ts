import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import {
  isWorded,
  lineProblem,
  slidesUnavailable,
  wordMove,
  wordMoveDetailed,
  type WordMoveInput,
} from "../src/lib/prompts/wordMove";

const FALLBACK = "So I could use it on my pebbles? They're all mixed up.";

const BASE: WordMoveInput = {
  kind: "question",
  level: "L1",
  conceptName: "Sorted input",
  studentWords: "You look at the middle and keep halving.",
  fallbackLine: FALLBACK,
};

/** A fake Grok that answers with the given lines, one per call, and records every request body. */
function fakeGrok(replies: Array<string | Error>) {
  const bodies: Array<{ messages: { role: string; content: string }[] }> = [];
  let i = 0;
  const fetchImpl = async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    const reply = replies[Math.min(i++, replies.length - 1)];
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  };
  return { fetchImpl, bodies, calls: () => i };
}

const saved = process.env.XAI_API_KEY;
beforeEach(() => {
  process.env.XAI_API_KEY = "test-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = saved;
});

describe("isWorded", () => {
  it("rewords check questions as well as later help", () => {
    expect(isWorded({ kind: "question", level: "L0" })).toBe(true);
    expect(isWorded({ kind: "question", level: "L1" })).toBe(true);
    expect(isWorded({ kind: "rephrase", level: "L3" })).toBe(true);
    expect(isWorded({ kind: "celebrate", level: "L0" })).toBe(true);
    expect(isWorded({ kind: "open", level: "L0" })).toBe(true);
    expect(isWorded({ kind: "wait", level: "L1" })).toBe(true);
  });

  it("never rewords the rule-defined lines", () => {
    for (const kind of ["ack", "offer_skip", "check_in", "pause", "wrap_up", "propose_wrap_up"] as const) {
      expect(isWorded({ kind: kind as never, level: "L1" })).toBe(false);
    }
  });
});

describe("lineProblem", () => {
  const ok = { kind: "question", level: "L1" } as const;

  it("accepts a short line with one question", () => {
    expect(lineProblem("Wait, does that work on a messy list?", ok)).toBeNull();
  });

  it("rejects an empty line, more than 20 words, and more than one question", () => {
    expect(lineProblem("   ", ok)).toMatch(/empty/);
    expect(lineProblem(Array(21).fill("word").join(" "), ok)).toMatch(/21 words/);
    expect(lineProblem(Array(19).fill("word").join(" ") + " ok?", ok)).toBeNull();
    expect(lineProblem("Why? And then what?", ok)).toMatch(/more than one question/);
  });

  it("rejects lines that cannot be spoken", () => {
    expect(lineProblem("**Why** is that?", ok)).toMatch(/symbols/);
    expect(lineProblem("Why is that? \u{1F986}", ok)).toMatch(/symbols/);
    expect(lineProblem('"Why is that?"', ok)).toMatch(/quotation/);
    expect(lineProblem("Why?\nHow?", ok)).toMatch(/single line/);
  });

  it("keeps slides out of the conversation, unless mentionSlides is switched on", () => {
    const l2 = { kind: "question", level: "L2", slide: 7 } as const;
    expect(lineProblem("What does slide 7 say about this?", l2)).toMatch(/slides/);
    expect(lineProblem("What has to be true for that to work?", l2)).toBeNull();
    DUCK.mentionSlides = true;
    try {
      expect(lineProblem("What does slide 7 say about this?", l2)).toBeNull();
      expect(lineProblem("What do the slides say about this?", l2)).toMatch(/slide 7/);
    } finally {
      DUCK.mentionSlides = false;
    }
  });

  it("rejects a line that points at a slide or page", () => {
    const l2 = { kind: "question", level: "L2" } as const;
    expect(lineProblem("Okay, let's try that.", l2)).toMatch(/only agrees/);
    expect(lineProblem("So the search space shrinks.", { ...l2, studentWords: "just 5 and 7" })).toMatch(/textbook/);
    expect(
      lineProblem("What if we sort those three numbers?", { ...l2, studentLost: true, studentWords: "it's a list" }),
    ).toMatch(/numbers/);
    expect(lineProblem("Hmm, does the order of the things matter?", l2)).toBeNull();
    expect(lineProblem("What does slide 7 say about this?", l2)).toMatch(/slide/);
    expect(lineProblem("Look at the notes and try again?", l2)).toMatch(/slide|page|screen/);
  });

  it("asks one question at L1 instead of stopping on a reflection", () => {
    expect(lineProblem("So you start in the middle.", { kind: "question", level: "L1" })).toMatch(/one natural question/);
    expect(lineProblem("So you start in the middle. What happens next?", { kind: "question", level: "L1" })).toBeNull();
  });

  it("rejects a line that asks the same thing again", () => {
    const last = "Three isn't the middle. Five is. Which numbers do you check?";
    expect(lineProblem("Five is the middle. Which numbers do you check?", { kind: "question", level: "L1", lastDuckLine: last })).toMatch(
      /repeats/,
    );
    expect(
      lineProblem("Once you are on five, what would you check next?", { kind: "question", level: "L1", lastDuckLine: last }),
    ).toBeNull();
    expect(lineProblem("What if we sorted the pebbles first?", { kind: "question", level: "L1" })).toMatch(/pebbles/);
    expect(lineProblem("Does the list have to be in order first?", { kind: "question", level: "L1" })).toBeNull();
    expect(
      lineProblem("Okay, is three really the middle of those numbers?", {
        kind: "question",
        level: "L1",
        studentWords: "Is 3 really the middle? Can you look at that list?",
      }),
    ).toMatch(/question back/);
    expect(
      lineProblem("Mm, so baking bread uses the same idea as the leaf then?", {
        kind: "open",
        level: "L2",
        studentWords: "Whatever, I was actually thinking about how to bake bread.",
        lastDuckLine: "Mm, is soil really the food for the leaf then?",
      }),
    ).toMatch(/changed the subject/);
  });

  it("makes L4 end with exactly one question, and a celebration have none", () => {
    expect(lineProblem("It needs a sorted list. Can you say why?", { kind: "question", level: "L4" })).toBeNull();
    expect(lineProblem("It needs a sorted list.", { kind: "question", level: "L4" })).toMatch(/say it back/);
    expect(lineProblem("Nice, you caught the infinite loop.", { kind: "celebrate", level: "L0" })).toBeNull();
    expect(lineProblem("Nice! Want to go on?", { kind: "celebrate", level: "L0" })).toMatch(/celebration/);
  });
});

describe("wordMoveDetailed", () => {
  it("returns Grok's line when it passes every check", async () => {
    const grok = fakeGrok(["Does the list have to be in order first?"]);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "Does the list have to be in order first?", source: "ai", attempts: 1 });
  });

  it("cleans up decoration like quotes and a leading label", async () => {
    const grok = fakeGrok(['Duck: "Does the list have to be in order first?"']);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result.line).toBe("Does the list have to be in order first?");
    expect(result.source).toBe("ai");
  });

  it("retries once when the line breaks a rule, and tells Grok what was wrong", async () => {
    const tooLong = Array(25).fill("word").join(" ");
    const grok = fakeGrok([tooLong, "Does the list have to be in order first?"]);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "Does the list have to be in order first?", source: "ai", attempts: 2 });
    const retry = grok.bodies[1].messages;
    expect(retry.at(-1)?.content).toMatch(/rejected because it has 25 words/);
    expect(retry.at(-2)?.role).toBe("assistant");
  });

  it("falls back to the precomputed line when both attempts break a rule", async () => {
    const grok = fakeGrok(["Why? And how?", "What? Really?"]);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: FALLBACK, source: "fallback", attempts: 2 });
    expect(result.problem).toMatch(/more than one question/);
    expect(grok.calls()).toBe(2); // never a third call
  });

  it("falls back at once, without a retry, when Grok is down, slow or unconfigured", async () => {
    const down = fakeGrok([new Error("offline")]);
    expect(await wordMoveDetailed(BASE, { fetchImpl: down.fetchImpl })).toMatchObject({
      line: FALLBACK,
      source: "fallback",
      attempts: 1,
      failure: "http",
    });
    expect(down.calls()).toBe(1);

    const slow = Object.assign(new Error("slow"), { name: "TimeoutError" });
    const timedOut = await wordMoveDetailed(BASE, { fetchImpl: fakeGrok([slow]).fetchImpl });
    expect(timedOut).toMatchObject({ source: "fallback", failure: "timeout" });

    delete process.env.XAI_API_KEY;
    expect(await wordMoveDetailed(BASE)).toMatchObject({ line: FALLBACK, source: "fallback", failure: "no_key" });
  });

  it("skips the retry when too little of the time budget is left", async () => {
    let clock = 0;
    const grok = fakeGrok([Array(25).fill("word").join(" "), "Does the list have to be in order first?"]);
    const fetchImpl: typeof grok.fetchImpl = async (url, init) => {
      clock += 3_000; // the first attempt used up most of the 3.5 s budget
      return grok.fetchImpl(url, init);
    };
    const result = await wordMoveDetailed(BASE, { fetchImpl, now: () => clock });
    expect(result).toMatchObject({ line: FALLBACK, source: "fallback", attempts: 1 });
    expect(grok.calls()).toBe(1);
  });

  it("words the /end wrap-up from the session situation, not a stub", async () => {
    const grok = fakeGrok(["You caught the update bug. Come back to log n."]);
    const result = await wordMoveDetailed(
      {
        kind: "wrap_up",
        level: "L0",
        conceptName: "O(log n)",
        topic: "Binary search",
        studentWords: "it halves each time",
        fallbackLine: "You found the update step. Revisit O(log n).",
        situation: "They owned the update step. Still shaky: O(log n).",
      },
      { fetchImpl: grok.fetchImpl },
    );
    expect(result).toMatchObject({
      line: "You caught the update bug. Come back to log n.",
      source: "ai",
    });
    expect(grok.bodies[0].messages[1].content).toMatch(/best moment/);
  });

  it("does not call Grok at all for lines the engine owns", async () => {
    const grok = fakeGrok(["should never be used"]);
    for (const input of [
      { ...BASE, kind: "ack" as const },
      { ...BASE, kind: "pause" as const },
      { ...BASE, kind: "wrap_up" as const, level: "L0" as const },
    ]) {
      const result = await wordMoveDetailed(input, { fetchImpl: grok.fetchImpl });
      expect(result).toMatchObject({ line: FALLBACK, source: "fixed", attempts: 0 });
    }
    expect(grok.calls()).toBe(0);
  });

  it("wordMove returns just the line", async () => {
    const grok = fakeGrok(["Does the list have to be in order first?"]);
    expect(await wordMove(BASE, { fetchImpl: grok.fetchImpl })).toBe("Does the list have to be in order first?");
  });
});

describe("what Grok is sent", () => {
  it("includes the level task, concept, plain line and the student's words, but nothing secret", async () => {
    const grok = fakeGrok(["Hmm, does the order of the things matter?"]);
    await wordMoveDetailed(
      { ...BASE, level: "L2", toneHint: "Likes jokes." },
      { fetchImpl: grok.fetchImpl },
    );
    const [system, user] = grok.bodies[0].messages;
    expect(system.content).toMatch(/20 words or fewer/);
    expect(user.content).toMatch(/everyday words/);
    expect(user.content).toContain("Concept: Sorted input");
    expect(user.content).not.toMatch(/slide 4/);
    expect(user.content).toContain(FALLBACK);
    expect(user.content).toContain("You look at the middle and keep halving.");
    expect(user.content).toMatch(/Intent of this move/);
    expect(user.content).toContain("Likes jokes.");
    expect(JSON.stringify(grok.bodies[0])).not.toMatch(/reference_code|expected_answer/);
  });

  it("tells Grok to reply to a greeting instead of reciting a quiz line", async () => {
    const grok = fakeGrok(["Hi! What are you going to teach me?"]);
    await wordMoveDetailed(
      {
        kind: "open",
        level: "L0",
        conceptName: "Sorted input",
        topic: "Binary search",
        studentWords: "Hello?",
        fallbackLine: "I don't really get binary search yet. How does it work?",
      },
      { fetchImpl: grok.fetchImpl },
    );
    const user = grok.bodies[0].messages[1].content;
    expect(user).toMatch(/Reply to what they just said/);
    expect(user).toContain("Hello?");
    expect(user).toContain("Binary search");
    expect(user).toMatch(/quiz a specific gap|NEVER say walk me through/i);
  });

  it("cuts a very long student turn down to its end and flattens line breaks", async () => {
    const grok = fakeGrok(["Does the list have to be in order first?"]);
    const long = "start ".repeat(300) + "THE END\nnew line";
    await wordMoveDetailed({ ...BASE, studentWords: long }, { fetchImpl: grok.fetchImpl });
    const user = grok.bodies[0].messages[1].content;
    expect(user).toContain("THE END new line");
    expect(user.length).toBeLessThan(1_200);
  });
});

describe("questions need a question mark", () => {
  it("turns a question that ends in a full stop into a real question", async () => {
    const grok = fakeGrok(["Does the order of the things matter."]);
    const result = await wordMoveDetailed({ ...BASE, level: "L2" }, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "Does the order of the things matter?", source: "ai" });
  });

  it("fixes only the last sentence, and leaves statements alone", async () => {
    const one = fakeGrok(["Order might matter. Does it."]);
    const fixed = await wordMoveDetailed({ ...BASE, level: "L2" }, { fetchImpl: one.fetchImpl });
    expect(fixed.line).toBe("Order might matter. Does it?");

    const statement = fakeGrok(["Imagine five numbers in a row. What happens if you check the middle."]);
    const kept = await wordMoveDetailed({ ...BASE, level: "L3" }, { fetchImpl: statement.fetchImpl });
    expect(kept.line).toBe("Imagine five numbers in a row. What happens if you check the middle?");
  });

  it("rejects an L3 line that is not a question, then retries", async () => {
    expect(lineProblem("Halving sounds neat.", { kind: "question", level: "L3" })).toMatch(/tiny example/);
    const grok = fakeGrok(["Halving sounds neat.", "Imagine five numbers. What happens after one check?"]);
    const result = await wordMoveDetailed({ ...BASE, level: "L3" }, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({
      line: "Imagine five numbers. What happens after one check?",
      attempts: 2,
    });
  });
});

describe("a student without the slides", () => {
  it("is recognised from what they said", () => {
    expect(slidesUnavailable("I don't have the slides right now.")).toBe(true);
    expect(slidesUnavailable("I can't see the slides")).toBe(true);
    expect(slidesUnavailable("No slides here, sorry")).toBe(true);
    expect(slidesUnavailable("The slides say it halves")).toBe(false);
    expect(slidesUnavailable("I don't know. Next slide")).toBe(false);
  });

  it("tells Grok not to mention slides, and does not demand slide N at L2", async () => {
    const grok = fakeGrok(["If my list is a jumble, would halving still work?"]);
    const input = { ...BASE, level: "L2" as const, slide: 4, studentWords: "I don't have the slides right now." };
    const result = await wordMoveDetailed(input, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ source: "ai", attempts: 1 });
    const user = grok.bodies[0].messages[1].content;
    expect(user).toMatch(/No slides|mention slides/i);
    expect(user).not.toContain("(slide 4)");
  });

  it("asks Grok to check the list it already spoke, and rejects a line that agrees with the wrong number", async () => {
    const asked = "Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?";
    const input: WordMoveInput = {
      ...BASE,
      conceptName: "When it stops",
      studentWords: "Okay so, I guess like we would start at 3?",
      fallbackLine: "Three isn't the middle. Five is. Which numbers do you check?",
      lastDuckLine: asked,
      spokenMiss: "three",
      conversation: `Duck: ${asked}\nStudent: Okay so, I guess like we would start at 3?`,
    };
    expect(
      lineProblem("So we start in the middle at three. What if six isn't hiding in there at all?", input),
    ).toMatch(/agrees three/);
    expect(lineProblem("So three might not really be the middle.", input)).toMatch(/might/);
    expect(lineProblem("What if the thing I want isn't in the list at all?", input)).toMatch(/never checks/);
    expect(lineProblem("Three isn't the middle. Five is. Which numbers do you check?", input)).toBeNull();
    expect(
      lineProblem("Five is the middle of one, three, five, seven, nine. Which numbers do you check?", input),
    ).toBeNull();

    const grok = fakeGrok([
      "So we start in the middle at three. What if six isn't hiding in there at all?",
      "Three isn't the middle. Five is. Which numbers do you check?",
    ]);
    const result = await wordMoveDetailed(input, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({
      line: "Three isn't the middle. Five is. Which numbers do you check?",
      source: "ai",
      attempts: 2,
    });
    const user = grok.bodies[0].messages[1].content;
    expect(user).toContain("They said three");
    expect(user).toContain("Conversation so far");
    expect(user).toContain("1, 3, 5, 7, 9");
    expect(user).not.toMatch(/\[5,\s*7\]|expectedAnswer/);
    expect(grok.bodies[0].messages[0].content).toMatch(/do not ask the same question again/i);
  });

  it("rejects a line that still mentions slides, then retries", async () => {
    const grok = fakeGrok(["What does slide 4 say about this?", "How would halving treat a jumbled list?"]);
    const input = { ...BASE, level: "L2" as const, slide: 4, studentWords: "I don't have the slides." };
    const result = await wordMoveDetailed(input, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "How would halving treat a jumbled list?", attempts: 2 });
    expect(grok.bodies[1].messages.at(-1)?.content).toMatch(/do not mention slides/);
  });
});
