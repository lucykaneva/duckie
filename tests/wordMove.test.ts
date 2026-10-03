import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  it("rewords help questions, rephrases, celebrations, and a reply to the student", () => {
    expect(isWorded({ kind: "question", level: "L1" })).toBe(true);
    expect(isWorded({ kind: "rephrase", level: "L3" })).toBe(true);
    expect(isWorded({ kind: "celebrate", level: "L0" })).toBe(true);
    expect(isWorded({ kind: "open", level: "L0" })).toBe(true);
  });

  it("never rewords the opening check question or the rule-defined lines", () => {
    expect(isWorded({ kind: "question", level: "L0" })).toBe(false);
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

  it("makes L2 name the slide, when there is one", () => {
    const l2 = { kind: "question", level: "L2", slide: 7 } as const;
    expect(lineProblem("What does slide 7 say about this?", l2)).toBeNull();
    expect(lineProblem("What do the slides say about this?", l2)).toMatch(/slide 7/);
    expect(lineProblem("What does slide 17 say?", l2)).toMatch(/slide 7/);
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
    const grok = fakeGrok(["Ooh, so would that work on my pebbles?"]);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "Ooh, so would that work on my pebbles?", source: "ai", attempts: 1 });
  });

  it("cleans up decoration like quotes and a leading label", async () => {
    const grok = fakeGrok(['Duck: "Does that work on my pebbles?"']);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result.line).toBe("Does that work on my pebbles?");
    expect(result.source).toBe("ai");
  });

  it("retries once when the line breaks a rule, and tells Grok what was wrong", async () => {
    const tooLong = Array(25).fill("word").join(" ");
    const grok = fakeGrok([tooLong, "Does that work on my pebbles?"]);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "Does that work on my pebbles?", source: "ai", attempts: 2 });
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
    const grok = fakeGrok([Array(25).fill("word").join(" "), "Does that work on my pebbles?"]);
    const fetchImpl: typeof grok.fetchImpl = async (url, init) => {
      clock += 3_000; // the first attempt used up most of the 3.5 s budget
      return grok.fetchImpl(url, init);
    };
    const result = await wordMoveDetailed(BASE, { fetchImpl, now: () => clock });
    expect(result).toMatchObject({ line: FALLBACK, source: "fallback", attempts: 1 });
    expect(grok.calls()).toBe(1);
  });

  it("does not call Grok at all for lines the engine owns", async () => {
    const grok = fakeGrok(["should never be used"]);
    for (const input of [
      { ...BASE, kind: "question" as const, level: "L0" as const },
      { ...BASE, kind: "ack" as const },
      { ...BASE, kind: "pause" as const },
    ]) {
      const result = await wordMoveDetailed(input, { fetchImpl: grok.fetchImpl });
      expect(result).toMatchObject({ line: FALLBACK, source: "fixed", attempts: 0 });
    }
    expect(grok.calls()).toBe(0);
  });

  it("wordMove returns just the line", async () => {
    const grok = fakeGrok(["Does that work on my pebbles?"]);
    expect(await wordMove(BASE, { fetchImpl: grok.fetchImpl })).toBe("Does that work on my pebbles?");
  });
});

describe("what Grok is sent", () => {
  it("includes the level task, concept, plain line and the student's words, but nothing secret", async () => {
    const grok = fakeGrok(["What does slide 4 say about the order?"]);
    await wordMoveDetailed(
      { ...BASE, level: "L2", slide: 4, toneHint: "Likes jokes." },
      { fetchImpl: grok.fetchImpl },
    );
    const [system, user] = grok.bodies[0].messages;
    expect(system.content).toMatch(/20 words or fewer/);
    expect(user.content).toMatch(/name slide 4/);
    expect(user.content).toContain("Concept: Sorted input (slide 4)");
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
        fallbackLine: "Ooh! Can you explain it to me? I'm just a duck.",
      },
      { fetchImpl: grok.fetchImpl },
    );
    const user = grok.bodies[0].messages[1].content;
    expect(user).toMatch(/Reply to what the student just said/);
    expect(user).toContain("Hello?");
    expect(user).toContain("Binary search");
    expect(user).toMatch(/do not recite/);
  });

  it("cuts a very long student turn down to its end and flattens line breaks", async () => {
    const grok = fakeGrok(["Does that work on my pebbles?"]);
    const long = "start ".repeat(300) + "THE END\nnew line";
    await wordMoveDetailed({ ...BASE, studentWords: long }, { fetchImpl: grok.fetchImpl });
    const user = grok.bodies[0].messages[1].content;
    expect(user).toContain("THE END new line");
    expect(user.length).toBeLessThan(1_200);
  });
});

describe("questions need a question mark", () => {
  it("turns a question that ends in a full stop into a real question", async () => {
    const grok = fakeGrok(["What does slide 4 say about this."]);
    const result = await wordMoveDetailed(
      { ...BASE, level: "L2", slide: 4 },
      { fetchImpl: grok.fetchImpl },
    );
    expect(result).toMatchObject({ line: "What does slide 4 say about this?", source: "ai" });
  });

  it("fixes only the last sentence, and leaves statements alone", async () => {
    const one = fakeGrok(["Slide 4 talks about order. What does it say."]);
    const fixed = await wordMoveDetailed({ ...BASE, level: "L2", slide: 4 }, { fetchImpl: one.fetchImpl });
    expect(fixed.line).toBe("Slide 4 talks about order. What does it say?");

    const statement = fakeGrok(["Try it with just 2, 5, 9, looking for 9."]);
    const kept = await wordMoveDetailed({ ...BASE, level: "L3" }, { fetchImpl: statement.fetchImpl });
    expect(kept.line).toBe("Try it with just 2, 5, 9, looking for 9.");
  });

  it("rejects an L1 or L2 line that is not a question at all, then retries", async () => {
    expect(lineProblem("Halving sounds neat.", { kind: "question", level: "L1" })).toMatch(/question mark/);
    const grok = fakeGrok(["Halving sounds neat.", "Does halving work on my pebbles?"]);
    const result = await wordMoveDetailed(BASE, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "Does halving work on my pebbles?", attempts: 2 });
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
    expect(user).toMatch(/do not mention slides/);
    expect(user).not.toContain("(slide 4)");
  });

  it("rejects a line that still mentions slides, then retries", async () => {
    const grok = fakeGrok(["What does slide 4 say about this?", "How would halving treat a jumbled list?"]);
    const input = { ...BASE, level: "L2" as const, slide: 4, studentWords: "I don't have the slides." };
    const result = await wordMoveDetailed(input, { fetchImpl: grok.fetchImpl });
    expect(result).toMatchObject({ line: "How would halving treat a jumbled list?", attempts: 2 });
    expect(grok.bodies[1].messages.at(-1)?.content).toMatch(/cannot see the slides/);
  });
});
