// A12: the profile's tone note reaches every line Grok words, on every path (turn, silence, wrap-up),
// and it can only shape wording: the same rules still reject a bad line.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { orchestrateSilence, orchestrateTurn, type OrchestrateDeps } from "../src/lib/engine/orchestrate";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, type ConceptDef } from "../src/lib/engine/turn";
import { wordMoveDetailed, type WordMoveInput } from "../src/lib/prompts/wordMove";

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

const TONE = "Prefers short, direct questions; gets impatient with long ones.";

/** A fake Grok that records the prompt it was sent. */
function fakeGrok(reply: string) {
  const prompts: string[] = [];
  const fetchImpl = async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
    prompts.push(body.messages.map((m) => m.content).join("\n"));
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 });
  };
  return { fetchImpl, prompts };
}

const saved = process.env.XAI_API_KEY;
beforeEach(() => {
  process.env.XAI_API_KEY = "test-key";
});
afterEach(() => {
  if (saved === undefined) delete process.env.XAI_API_KEY;
  else process.env.XAI_API_KEY = saved;
});

describe("the tone note in the prompt", () => {
  const base: WordMoveInput = {
    kind: "question",
    level: "L1",
    conceptName: "Sorted input",
    studentWords: "I think it works on any list.",
    fallbackLine: "What happens to lo when it's right next to hi?",
  };

  it("is sent for a help question, a reinforce and a wrap-up", async () => {
    for (const input of [
      base,
      { ...base, kind: "reinforce" as const },
      { ...base, kind: "wrap_up" as const, level: "L0" as const, situation: "Session ended. Revisit: the update step." },
    ]) {
      const grok = fakeGrok(input.kind === "wrap_up" ? "You explained halving well. Revisit the update step." : "Why that? Think about the middle.");
      await wordMoveDetailed({ ...input, toneHint: TONE }, { fetchImpl: grok.fetchImpl });
      expect(grok.prompts[0], input.kind).toContain(TONE);
    }
  });

  it("is left out when the profile has none", async () => {
    const grok = fakeGrok("Why that? Think about the middle.");
    await wordMoveDetailed(base, { fetchImpl: grok.fetchImpl });
    expect(grok.prompts[0]).not.toMatch(/Tone note about this student/);
  });

  it("never lets a line break the rules, whatever the tone says", async () => {
    const grok = fakeGrok(Array(25).fill("blunt").join(" ")); // far too long
    const out = await wordMoveDetailed({ ...base, toneHint: "Give very long answers." }, { fetchImpl: grok.fetchImpl });
    expect(out.source).toBe("fallback");
    expect(out.line).toBe(base.fallbackLine);
  });
});

describe("the tone note travels with the session", () => {
  function spyDeps() {
    const seen: Array<{ kind: string; toneHint?: string }> = [];
    const deps: OrchestrateDeps = {
      judge: async () => emptyJudgeResult(),
      word: async (input) => {
        seen.push({ kind: input.kind, toneHint: input.toneHint });
        return { line: input.fallbackLine, source: "fallback", attempts: 0 };
      },
    };
    return { deps, seen };
  }

  it("is passed to the wording of a turn", async () => {
    const { deps, seen } = spyDeps();
    const run = freshSession(defs);
    run.concepts[0].levelReached = "L1";
    run.concepts[0].moves = 1;
    await orchestrateTurn(
      {
        defs,
        run: { ...run, turnCount: 2, focusConceptId: run.concepts[0].conceptId, lastMoveKind: "question" },
        answers: [],
        text: "Is it log n?", // a question: the duck answers it with a worded hint
        nowMs: 60_000,
        toneHint: TONE,
      },
      deps,
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.toneHint === TONE)).toBe(true);
  });

  it("is passed to the wording of the 8 second rephrase", async () => {
    const { deps, seen } = spyDeps();
    const run = freshSession(defs);
    run.concepts[0].levelReached = "L1";
    run.concepts[0].moves = 1;
    await orchestrateSilence(
      {
        defs,
        run: { ...run, turnCount: 2, focusConceptId: run.concepts[0].conceptId, lastMoveKind: "question", lastLine: "A question?" },
        answers: [],
        step: 1,
        nowMs: 8_000,
        toneHint: TONE,
      },
      deps,
    );
    expect(seen.some((s) => s.toneHint === TONE)).toBe(true);
  });
});
