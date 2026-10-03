import { spawn } from "node:child_process";
import { ENGINE } from "../duck/config";
import { normalizeAnswer } from "./answers";

// Runs a concept's reference code to get the true answer (spec rule 7: checked answers come from code).
// The code is written by the AI and can be wrong or hostile, so it never runs in the server itself:
//   - a separate child process with an empty environment (no API keys, no database URL)
//   - inside an empty vm context: no process, require, fetch or timers
//   - eval and new Function are switched off inside that context, which closes the usual escapes
//   - the script stops after codeTimeoutMs (infinite loops), the process is killed after codeWallMs,
//     and its memory is capped
// Node's vm module alone is not a security boundary; the process around it is what limits the damage.

const RUNNER = `
const vm = require("node:vm");
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let result;
  try {
    const value = vm.runInNewContext("(function () {" + input + "\\n})()", Object.create(null), {
      timeout: ${ENGINE.codeTimeoutMs},
      microtaskMode: "afterEvaluate",
      codeGeneration: { strings: false, wasm: false },
    });
    result = { ok: true, json: JSON.stringify(value) };
  } catch (error) {
    result = { ok: false, error: String((error && error.message) || error).slice(0, 200) };
  }
  process.stdout.write(JSON.stringify(result));
});
`;

export type RunResult =
  | {
      ok: true;
      /** The answer as compact JSON, for example "[5,7]". Safe to store and to compare. */
      json: string;
    }
  | { ok: false; error: string };

/** Run the body of a function that takes no input and returns the answer. Never throws. */
export function runReferenceCode(code: string): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: RunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let stdout = "";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(
        process.execPath,
        [`--max-old-space-size=${ENGINE.codeMemoryMb}`, "-e", RUNNER],
        { env: {} as NodeJS.ProcessEnv, stdio: ["pipe", "pipe", "ignore"] },
      );
    } catch (error) {
      done({ ok: false, error: `could not start the code runner: ${(error as Error).message}` });
      return;
    }

    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      done({ ok: false, error: "the code took too long" });
    }, ENGINE.codeWallMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > ENGINE.codeMaxOutputChars * 2) {
        child.kill("SIGKILL");
        done({ ok: false, error: "the code returned too much" });
      }
    });
    child.on("error", (error) => {
      clearTimeout(killer);
      done({ ok: false, error: `could not run the code: ${error.message}` });
    });
    child.on("close", () => {
      clearTimeout(killer);
      try {
        const parsed = JSON.parse(stdout) as { ok: boolean; json?: string; error?: string };
        if (!parsed.ok) {
          done({ ok: false, error: parsed.error ?? "the code failed" });
          return;
        }
        if (parsed.json === undefined) {
          done({ ok: false, error: "the code returned nothing" });
          return;
        }
        if (parsed.json.length > ENGINE.codeMaxOutputChars) {
          done({ ok: false, error: "the code returned too much" });
          return;
        }
        const normalized = normalizeAnswer(parsed.json);
        done(normalized ? { ok: true, json: normalized } : { ok: false, error: "the code returned an answer we cannot check" });
      } catch {
        done({ ok: false, error: "the code crashed or ran out of memory" });
      }
    });

    child.stdin?.on("error", () => {});
    child.stdin?.end(code);
  });
}
