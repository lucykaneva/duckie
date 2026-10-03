import { describe, expect, it } from "vitest";
import { DUCK } from "../src/lib/duck/config";
import { SEED_CONCEPTS } from "../src/lib/db/seed-data";

const lines = SEED_CONCEPTS.flatMap((c) =>
  Object.entries(c.fallbackQuestions).map(([level, text]) => ({
    concept: c.name,
    level,
    text,
  })),
);

describe("demo seed", () => {
  it("has the 5 concepts from the worked example, with unique ids", () => {
    expect(SEED_CONCEPTS.map((c) => c.name)).toEqual([
      "Sorted input",
      "Halving",
      "When it stops",
      "The update step",
      "O(log n)",
    ]);
    expect(new Set(SEED_CONCEPTS.map((c) => c.id)).size).toBe(5);
  });

  it("has L1 to L4 fallback lines for every concept", () => {
    for (const c of SEED_CONCEPTS) {
      expect(Object.keys(c.fallbackQuestions)).toEqual(["L1", "L2", "L3", "L4"]);
    }
  });

  it("ends every L4 line with the teach-back question", () => {
    for (const c of SEED_CONCEPTS) {
      expect(c.fallbackQuestions.L4.trim().endsWith("?")).toBe(true);
    }
  });

  it("keeps check prompts within the duck's limits, with the ack in front", () => {
    for (const c of SEED_CONCEPTS) {
      // "Okay, that makes sense now." (5 words) can sit in front of any check prompt
      const words = `Okay, that makes sense now. ${c.checkPrompt}`.split(/\s+/).length;
      expect(words).toBeLessThanOrEqual(DUCK.maxDuckWords);
      expect((c.checkPrompt.match(/\?/g) ?? []).length).toBe(1);
    }
  });

  it.each(lines)(
    "$concept $level fallback is within the duck's limits",
    ({ text }) => {
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(DUCK.maxDuckWords);
      expect((text.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    },
  );

  it("keeps the update-step misconception from the spec", () => {
    const update = SEED_CONCEPTS.find((c) => c.name === "The update step");
    expect(update?.misconceptions).toContain("lo = mid is fine");
  });

  it("stores the trace secret and its reference code produces it", () => {
    const withSecret = SEED_CONCEPTS.filter((c) => c.secret);
    expect(withSecret.map((c) => c.name)).toEqual(["When it stops"]);
    const secret = withSecret[0].secret!;
    const result = new Function(secret.referenceCode)();
    expect(JSON.stringify(result)).toBe(secret.expectedAnswer);
    expect(result).toEqual([5, 7]);
  });
});
