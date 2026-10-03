import { describe, expect, it } from "vitest";
import { sessionLog, toDecisionLogRows } from "../src/lib/engine/decisionLog";

describe("decision log", () => {
  it("lists every row in order with signals, score, level and line", () => {
    const log = sessionLog("s_1", "Binary search", [
      {
        id: "t_2",
        sessionId: "s_1",
        n: 2,
        source: "student",
        text: "you start at the middle",
        signals: ["vague"],
        scoreAfter: 0.25,
        level: "L1",
        moveKind: "question",
        line: "So the pebbles have to be sorted first?",
        conceptId: "c_12",
        conceptName: "Sorted input",
        meta: { judge: "ok", words: [{ source: "ai", attempts: 1 }] },
      },
      {
        id: "t_1",
        sessionId: "s_1",
        n: 1,
        source: "silence",
        text: "",
        signals: ["silence"],
        scoreAfter: 0.25,
        level: "L1",
        moveKind: "rephrase",
        line: "I missed that. What about the order?",
        conceptId: "c_12",
        conceptName: "Sorted input",
        meta: { judge: "skipped" },
      },
    ]);

    expect(log.turns.map((row) => row.n)).toEqual([1, 2]);
    expect(log.turns[1]).toMatchObject({
      text: "you start at the middle",
      signals: ["vague"],
      scoreAfter: 0.25,
      level: "L1",
      line: "So the pebbles have to be sorted first?",
    });
  });

  it("drops unknown meta and never invents a source", () => {
    const [row] = toDecisionLogRows([
      {
        id: "t_1",
        sessionId: "s_1",
        n: 1,
        text: "hello",
        meta: { judge: "ok", expected_answer: "5,7", reference_code: "secret" },
      },
    ]);
    expect(row.source).toBe("student");
    expect(row.meta).toEqual({ judge: "ok" });
    expect(JSON.stringify(row)).not.toMatch(/expected_answer|reference_code/);
  });
});
