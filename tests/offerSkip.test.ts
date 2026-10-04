// When the ladder is used up the duck offers to leave the idea for later. Never a slide.
import { describe, expect, it } from "vitest";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";
import { DUCK, ENGINE } from "../src/lib/duck/config";
import { emptyJudgeResult } from "../src/lib/engine/stub-judge";
import { freshSession, processTurn, type ConceptDef, type SessionRun } from "../src/lib/engine/turn";
import { offerSkipLine, wordCount } from "../src/lib/engine/wording";

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
const turn = (s: SessionRun, text: string) => processTurn(defs, s, { text, judge: emptyJudgeResult(), nowMs: 60_000 });

/** The student was explained to (L4) and is still stuck. */
function exhausted(): SessionRun {
  const run = freshSession(defs);
  const c = run.concepts.find((x) => x.conceptId === "c_14")!;
  Object.assign(c, { levelReached: "L4", moves: 5, failedAttempts: 5, score: 1 });
  return { ...run, turnCount: 8, focusConceptId: "c_14", lastMoveKind: "question", lastLine: "Can you say that back?" };
}

describe("the offer when the student is still stuck", () => {
  it("offers to leave it and come back, without naming a slide", () => {
    const out = turn(exhausted(), "No?");
    const slide = defs.find((d) => d.id === "c_14")?.slide;
    expect(out.move.kind).toBe("offer_skip");
    expect(out.move.line).toBe(offerSkipLine(slide));
    expect(out.move.line).not.toMatch(/slide/i);
    expect(out.move.line).toMatch(/come back/);
  });

  it("follows the duck's rules: 20 words or fewer, one question", () => {
    const line = offerSkipLine(7);
    expect(wordCount(line)).toBeLessThanOrEqual(20);
    expect((line.match(/\?/g) ?? []).length).toBe(1);
  });

  it("names the slide only when mentionSlides is on, and the idea has one", () => {
    expect(offerSkipLine(undefined)).not.toMatch(/slide/i);
    expect(offerSkipLine(0)).not.toMatch(/slide/i);
    DUCK.mentionSlides = true;
    try {
      expect(offerSkipLine(7)).toMatch(/slide 7/);
      expect(offerSkipLine(undefined)).not.toMatch(/slide/i);
    } finally {
      DUCK.mentionSlides = false;
    }
  });

  it("moves on, marked as skipped (so it is revisited), only after a plain yes", () => {
    const offered = turn(exhausted(), "No?");
    const stays = turn(offered.session, "Hmm I don't know");
    expect(stays.session.concepts.find((c) => c.conceptId === "c_14")!.skipped).toBe(false);

    const yes = turn(offered.session, "Yes");
    const c = yes.session.concepts.find((x) => x.conceptId === "c_14")!;
    expect(c.skipped).toBe(true);
    expect(c.state).toBe("skipped");
    expect((yes.move.then ?? yes.move).conceptId).not.toBe("c_14");
  });
});
