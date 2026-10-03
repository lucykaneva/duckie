import { describe, expect, it } from "vitest";
import { TRACE_REFERENCE_CODE } from "../src/lib/db/seed-data";
import { runReferenceCode } from "../src/lib/engine/run-code";

// These start a real child process each, so they are the slow tests (about a second for the loop).

describe("running reference code in the sandbox", () => {
  it("returns the answer for the seed's binary search code", async () => {
    expect(await runReferenceCode(TRACE_REFERENCE_CODE)).toEqual({ ok: true, json: "[5,7]" });
  });

  it("returns numbers, words and booleans as JSON", async () => {
    expect(await runReferenceCode("return 20;")).toEqual({ ok: true, json: "20" });
    expect(await runReferenceCode("return 'middle';")).toEqual({ ok: true, json: '"middle"' });
    expect(await runReferenceCode("return 1 < 2;")).toEqual({ ok: true, json: "true" });
  });

  it("survives a trailing comment on the last line", async () => {
    expect(await runReferenceCode("return [1, 2]; // done")).toEqual({ ok: true, json: "[1,2]" });
  });

  it("reports code that throws or is not valid", async () => {
    const thrown = await runReferenceCode("throw new Error('boom');");
    expect(thrown).toMatchObject({ ok: false });
    expect(await runReferenceCode("return (;")).toMatchObject({ ok: false });
  });

  it("refuses an answer it cannot check", async () => {
    for (const code of ["return {a: 1};", "return;", "return [[1]];", "return () => 1;", "return NaN;", "return null;"]) {
      expect(await runReferenceCode(code), code).toMatchObject({ ok: false });
    }
  });

  it("stops an infinite loop", async () => {
    const started = Date.now();
    const result = await runReferenceCode("while (true) {}");
    expect(result).toMatchObject({ ok: false });
    expect(Date.now() - started).toBeLessThan(3_500);
  });

  it("stops a promise that never settles from hanging the server", async () => {
    const result = await runReferenceCode("return new Promise(() => {});");
    expect(result).toMatchObject({ ok: false });
  });

  it("cannot reach process, require, fetch or timers", async () => {
    const result = await runReferenceCode(
      "return [typeof process, typeof require, typeof fetch, typeof setTimeout, typeof globalThis.process].join(',');",
    );
    expect(result).toEqual({ ok: true, json: '"undefined,undefined,undefined,undefined,undefined"' });
  });

  it("cannot get at the server's secrets", async () => {
    process.env.B10_TEST_SECRET = "do-not-leak";
    try {
      for (const code of [
        "return process.env.B10_TEST_SECRET;",
        "return this.constructor.constructor('return process')().env.B10_TEST_SECRET;",
        "return (() => {}).constructor('return process')().env.B10_TEST_SECRET;",
        "return Promise.resolve(1).constructor.constructor('return process')().env.B10_TEST_SECRET;",
        "return [].constructor.constructor('return this')().process.env.B10_TEST_SECRET;",
        "return eval('process.env.B10_TEST_SECRET');",
        "return new Function('return process.env.B10_TEST_SECRET')();",
      ]) {
        const result = await runReferenceCode(code);
        expect(result.ok, code).toBe(false);
        expect(JSON.stringify(result), code).not.toContain("do-not-leak");
      }
    } finally {
      delete process.env.B10_TEST_SECRET;
    }
  });

  it("is killed instead of using all the memory", async () => {
    const result = await runReferenceCode("const a = []; while (true) { a.push(new Array(1e6).fill(1)); }");
    expect(result).toMatchObject({ ok: false });
  });

  it("does not let one call affect the next", async () => {
    await runReferenceCode("return 1;");
    expect(await runReferenceCode("return typeof globalThis.leftover;")).toEqual({ ok: true, json: '"undefined"' });
  });
});
