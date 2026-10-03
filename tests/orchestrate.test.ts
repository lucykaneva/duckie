import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { needsJudge, orchestrateSilence, orchestrateTurn } from "../src/lib/engine/orchestrate";
import type { OrchestrateDeps } from "../src/lib/engine/orchestrate";
import { freshSession, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { wordCount } from "../src/lib/engine/wording";
import { judgeTurn } from "../src/lib/prompts/judgeTurn";
import { wordMoveDetailed } from "../src/lib/prompts/wordMove";

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

const answers = [{ conceptId: "c_14", expectedAnswer: "[5,7]" }];
const stateOf = (run: SessionRun, id: string) => run.concepts.find((c) => c.conceptId === id)!;
const line = (id: string, level: "L1" | "L2" | "L3" | "L4") =>
  defs.find((d) => d.id === id)!.fallbackQuestions[level]!;

const savedKey = process.env.XAI_API_KEY;
beforeEach(() => {
  process.env.XAI_API_KEY = "test-key";
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = savedKey;
});

/** One Grok-shaped JSON object: the real judgeTurn parses this and drops quotes that are not in the turn. */
function verdicts(rows: { conceptId: string; covered?: string; misconception?: string; vague?: string }[]) {
  return JSON.stringify({
    concepts: rows.map((r) => ({
      conceptId: r.conceptId,
      covered: r.covered ?? null,
      misconception: r.misconception ?? null,
      vague: r.vague ?? null,
      contradiction: null,
    })),
  });
}

/**
 * Real judgeTurn and wordMove, with Grok's HTTP replaced. The functions still parse, check quotes,
 * reject bad lines, retry once, and fall back. Nothing here invents a JudgeResult or a spoken line.
 */
function withGrok(replies: { judge?: Array<string | Error>; word?: Array<string | Error> }): OrchestrateDeps & {
  judgeCalls: number;
  wordCalls: number;
} {
  let judgeCalls = 0;
  let wordCalls = 0;
  const next = (queue: Array<string | Error> | undefined, i: number): string | Error => {
    if (!queue || queue.length === 0) return "{}";
    return queue[Math.min(i, queue.length - 1)];
  };
  const asFetch = (queue: Array<string | Error> | undefined, onCall: () => number): typeof fetch =>
    async () => {
      const reply = next(queue, onCall() - 1);
      if (reply instanceof Error) throw reply;
      return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
    };
  return {
    get judgeCalls() {
      return judgeCalls;
    },
    get wordCalls() {
      return wordCalls;
    },
    judge: (input) => judgeTurn(input, { fetchImpl: asFetch(replies.judge, () => ++judgeCalls) }),
    word: (input) => wordMoveDetailed(input, { fetchImpl: asFetch(replies.word, () => ++wordCalls) }),
  };
}

const timeout = () => new DOMException("timed out", "TimeoutError");

describe("needsJudge", () => {
  it("skips the Grok call for turns the engine handles without scoring", () => {
    const s = freshSession(defs);
    expect(needsJudge(s, "")).toBe(false);
    expect(needsJudge({ ...s, closing: true }, "one more thing")).toBe(false);
    expect(needsJudge(s, "let's wrap up")).toBe(false);
    expect(needsJudge(s, "skip this one")).toBe(false);
    expect(needsJudge({ ...s, lastMoveKind: "offer_skip" }, "yes")).toBe(false);
    expect(needsJudge({ ...s, pending: "check_in" }, "keep going")).toBe(false);
    expect(needsJudge({ ...s, pending: "wrap_proposal" }, "okay")).toBe(false);
    expect(needsJudge({ ...s, pausedAtMs: 1 }, "I'm back")).toBe(false);
  });

  it("asks the judge so Grok can tell a hello from a real explanation", () => {
    expect(needsJudge(freshSession(defs), "Hello?")).toBe(true);
    expect(needsJudge(freshSession(defs), "You keep halving the list.")).toBe(true);
  });
});

describe("the AI falling back", () => {
  it("evaluates with code-only signals when the judge times out", async () => {
    const deps = withGrok({ judge: [timeout()], word: [timeout()] });
    const s = freshSession(defs);
    s.turnCount = 2;
    s.focusConceptId = "c_12";
    s.lastMoveKind = "question";
    stateOf(s, "c_12").moves = 1;
    const { outcome, meta } = await orchestrateTurn(
      {
        defs,
        run: s,
        answers,
        text: "Um, I think maybe it just works or something.",
        nowMs: 0,
      },
      deps,
    );
    expect(meta.judge).toBe("timeout");
    expect(outcome.signals).toEqual(["hedging"]);
    expect(outcome.move.kind).toBe("question");
    expect(outcome.move.line.length).toBeGreaterThan(0);
  });

  it("uses the precomputed line when wordMove rejects both attempts", async () => {
    const s = freshSession(defs);
    s.turnCount = 2;
    s.focusConceptId = "c_12";
    s.lastMoveKind = "question";
    stateOf(s, "c_12").moves = 1;
    const tooLong = Array(21).fill("word").join(" ");
    const deps = withGrok({
      judge: [verdicts([])],
      word: [tooLong, tooLong],
    });
    const { outcome, meta } = await orchestrateTurn(
      { defs, run: s, answers, text: "I don't know", nowMs: 0 },
      deps,
    );
    expect(meta.words[0]).toMatchObject({ source: "fallback" });
    expect(meta.words[0].attempts).toBe(2);
    expect(outcome.move.line).toBe(line("c_12", "L2"));
  });

  it("blocks a leaking line that wordMove wrote, and still speaks something safe", async () => {
    const s = freshSession(defs);
    s.turnCount = 2;
    s.focusConceptId = "c_14";
    s.lastMoveKind = "question";
    stateOf(s, "c_14").moves = 1;
    const deps = withGrok({
      judge: [verdicts([])],
      // Must name the slide so wordMove accepts an L2 line; the leak check then blocks the answer.
      word: ["Slide 7 says you check 5 and 7, right?"],
    });
    const { outcome, meta } = await orchestrateTurn(
      { defs, run: s, answers, text: "I don't know", nowMs: 0 },
      deps,
    );
    expect(meta.leakBlocked).toEqual(["c_14"]);
    expect(outcome.move.line).not.toMatch(/5\s+and\s+7|5,\s*7/);
    expect(wordCount(outcome.move.line)).toBeLessThanOrEqual(DUCK.maxDuckWords);
  });

  it("does not count a trace, planted claim or later quiz as missed on the explanation turn", async () => {
    const text = "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.";
    const deps = withGrok({
      judge: [
        verdicts([
          { conceptId: "c_13", covered: "You keep halving" },
          { conceptId: "c_12" },
          { conceptId: "c_14" },
          { conceptId: "c_15" },
          { conceptId: "c_16" },
        ]),
      ],
      word: ["Wait, so my pebbles have to be in order first?"],
    });
    const { outcome } = await orchestrateTurn({ defs, run: freshSession(defs), answers, text, nowMs: 0 }, deps);
    expect(stateOf(outcome.session, "c_13").state).toBe("owned");
    expect(stateOf(outcome.session, "c_12").score).toBe(0.3);
    expect(stateOf(outcome.session, "c_14").score).toBe(0);
    expect(stateOf(outcome.session, "c_15").score).toBe(0);
    expect(stateOf(outcome.session, "c_16").score).toBe(0);
  });

  it("treats 'I think that's fine?' after a planted claim as a misconception, even if the judge misses it", async () => {
    const s = freshSession(defs);
    s.turnCount = 4;
    s.focusConceptId = "c_15";
    s.lastMoveKind = "question";
    s.lastLine = defs.find((d) => d.id === "c_15")!.checkPrompt!;
    stateOf(s, "c_12").state = "assisted";
    stateOf(s, "c_13").state = "owned";
    stateOf(s, "c_14").state = "assisted";
    stateOf(s, "c_15").moves = 1;
    const deps = withGrok({
      judge: [verdicts([{ conceptId: "c_15" }])],
      word: ["What happens to lo when it's right next to hi?"],
    });
    const { outcome } = await orchestrateTurn(
      { defs, run: s, answers, text: "I think that's fine?", nowMs: 0 },
      deps,
    );
    expect(stateOf(outcome.session, "c_15")).toMatchObject({ state: "misconception", score: 0.3 });
    expect(outcome.move).toMatchObject({ kind: "question", level: "L1", conceptId: "c_15" });
    expect(outcome.signals).toContain("misconception");
  });

  it("does not treat a correction of the planted claim as a misconception", async () => {
    const s = freshSession(defs);
    s.turnCount = 4;
    s.focusConceptId = "c_15";
    s.lastMoveKind = "question";
    s.lastLine = defs.find((d) => d.id === "c_15")!.checkPrompt!;
    stateOf(s, "c_15").moves = 1;
    const deps = withGrok({
      judge: [
        verdicts([{ conceptId: "c_15", covered: "it loops forever" }]),
      ],
    });
    const { outcome } = await orchestrateTurn(
      {
        defs,
        run: s,
        answers,
        text: "No, that would loop forever, it has to be mid plus one.",
        nowMs: 0,
      },
      deps,
    );
    expect(outcome.signals).not.toContain("misconception");
    expect(stateOf(outcome.session, "c_15").state).not.toBe("misconception");
  });

  it("rewrites an 8 s rephrase through wordMove", async () => {
    const s = freshSession(defs);
    s.focusConceptId = "c_12";
    s.lastMoveKind = "question";
    s.lastLine = line("c_12", "L1");
    stateOf(s, "c_12").levelReached = "L1";
    stateOf(s, "c_12").moves = 1;
    const deps = withGrok({ word: ["Wait, so my pebbles have to be in order first?"] });
    const out = await orchestrateSilence({ defs, run: s, answers, step: 1, nowMs: 8_000 }, deps);
    expect(out).not.toBeNull();
    expect(deps.wordCalls).toBe(1);
    expect(out!.move.kind).toBe("rephrase");
    expect(out!.move.line).toBe("Wait, so my pebbles have to be in order first?");
    expect(out!.signals).toEqual(["silence"]);
    expect(out!.meta.judge).toBe("skipped");
    expect(out!.meta.words[0].source).toBe("ai");
  });
});

describe("worked example through the real judgeTurn and wordMove", () => {
  it("replays every level, with a decision logged per turn", async () => {
    const log: { kind: string; level: string; conceptId: string; line: string; signals: string[] }[] = [];
    let run = freshSession(defs);

    const turns = [
      {
        text: "You look at the middle. If the target's bigger you go right, otherwise left. You keep halving.",
        grok: verdicts([{ conceptId: "c_13", covered: "You keep halving" }, { conceptId: "c_12" }]),
        spoken: "Wait, so my pebbles have to be in order first?",
      },
      {
        text: "No, they have to be sorted, or you could throw away the half with the target.",
        grok: verdicts([{ conceptId: "c_12", covered: "they have to be sorted" }]),
      },
      {
        text: "Um, I think 5, then 7, then maybe 9?",
        grok: verdicts([]),
        spoken: "Slide 7 shows when it stops. What has to be true to stop?",
      },
      {
        text: "When there's nothing left to search. After 7 there's nothing left, so just 5 and 7.",
        grok: verdicts([]),
        spoken: "Ooh, nice. You found where it stops.",
      },
      {
        text: "I think that's fine?",
        grok: verdicts([{ conceptId: "c_15", misconception: "I think that's fine?" }]),
        spoken: "What happens to lo when it's right next to hi?",
      },
      {
        text: "It stays the same… so it loops forever.",
        grok: verdicts([{ conceptId: "c_15", covered: "it loops forever" }]),
      },
      {
        text: "About twenty.",
        grok: verdicts([{ conceptId: "c_16", covered: "About twenty" }]),
      },
    ];

    // One judge reply per turn; wordMove is only called for help questions, rephrases and celebrations.
    const judgeReplies = turns.map((t) => t.grok);
    const wordReplies = turns.flatMap((t) => (t.spoken ? [t.spoken] : []));
    const deps = withGrok({ judge: judgeReplies, word: wordReplies });

    for (const turn of turns) {
      const { outcome, meta } = await orchestrateTurn(
        { defs, run, answers, text: turn.text, nowMs: run.turnCount * 30_000 },
        deps,
      );
      log.push({
        kind: outcome.move.kind,
        level: outcome.move.level,
        conceptId: outcome.move.conceptId,
        line: outcome.move.line,
        signals: outcome.signals,
      });
      expect(meta.judge).toBe("ok");
      expect(wordCount(outcome.move.line)).toBeLessThanOrEqual(DUCK.maxDuckWords);
      if (outcome.move.then) {
        log.push({
          kind: outcome.move.then.kind,
          level: outcome.move.then.level,
          conceptId: outcome.move.then.conceptId,
          line: outcome.move.then.line,
          signals: [],
        });
      }
      run = outcome.session;
    }

    expect(log.map((r) => [r.kind, r.level, r.conceptId])).toEqual([
      ["question", "L1", "c_12"],
      ["question", "L0", "c_14"],
      ["question", "L2", "c_14"],
      ["celebrate", "L2", "c_14"],
      ["question", "L0", "c_15"],
      ["question", "L1", "c_15"],
      ["question", "L0", "c_16"],
      ["check_in", "L0", "c_16"],
    ]);
    expect(log[0].line).toBe("Wait, so my pebbles have to be in order first?");
    expect(log[1].line).toBe("Got it. Test me: 1, 3, 5, 7, 9, looking for 6. Which numbers do you check?");
    expect(log[2].signals).toEqual(["wrongTrace", "hedging"]);
    expect(log[2].line).toBe("Slide 7 shows when it stops. What has to be true to stop?");
    expect(log[3].kind).toBe("celebrate");
    expect(log[3].line).toBe("Ooh, nice. You found where it stops.");
    expect(log[4].line).toBe("My friend wrote lo = mid, not mid + 1. Is that okay?");
    expect(run.concepts.map((c) => c.state)).toEqual(["assisted", "owned", "assisted", "assisted", "owned"]);
    expect(deps.judgeCalls).toBe(turns.length);
    expect(deps.wordCalls).toBe(wordReplies.length);
    expect(log).toHaveLength(8);
  });
});
