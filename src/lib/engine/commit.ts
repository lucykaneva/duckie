import { compareAnswer, numbersIn, parseExpected } from "./answers";
import type { StoredAnswer } from "./guard";
import { detectQuestion } from "./signals";
import type { ConceptDef, SessionRun } from "./turn";

/** At least two numbers, and one of them is in the stored trace. "About twenty" is not a trace. */
function looksLikeTraceAttempt(text: string, expectedJson: string): boolean {
  const expected = parseExpected(expectedJson);
  if (!expected || expected.kind !== "numbers") return false;
  const said = numbersIn(text);
  if (said.length < 2) return false;
  return said.some((n) => expected.values.some((v) => Math.abs(n - v) < 1e-9));
}

/**
 * They named some but not all of a list answer, and they asked a question.
 * "Okay, five. Then what?" is a follow-up. "Start at 3" is still an attempt, because 3 is not in the answer.
 */
function askingAside(text: string, expectedJson: string): boolean {
  if (!detectQuestion(text)) return false;
  const expected = parseExpected(expectedJson);
  if (!expected || expected.kind !== "numbers" || expected.values.length < 2) return false;
  const said = numbersIn(text);
  if (said.length === 0 || said.length >= expected.values.length) return false;
  return said.every((n) => expected.values.some((v) => Math.abs(n - v) < 1e-9));
}

function commitOn(
  conceptId: string,
  text: string,
  run: SessionRun,
  defs: ConceptDef[],
  answers: StoredAnswer[],
  requireAttemptShape: boolean,
): { conceptId: string; correct: boolean } | undefined {
  const focus = run.concepts.find((c) => c.conceptId === conceptId);
  const def = defs.find((d) => d.id === conceptId);
  const stored = answers.find((a) => a.conceptId === conceptId);
  if (!focus || !def || !stored || def.kind === "explain") return undefined;
  if (focus.skipped || (focus.state !== "not_yet" && focus.state !== "misconception")) return undefined;
  if (focus.levelReached === "L3") return undefined;
  // "Five, then what?" names part of a list answer and asks a follow-up. That is not a committed trace.
  if (askingAside(text, stored.expectedAnswer)) return undefined;
  if (requireAttemptShape && !looksLikeTraceAttempt(text, stored.expectedAnswer)) return undefined;
  const verdict = compareAnswer(text, stored.expectedAnswer);
  return verdict === "none" ? undefined : { conceptId: focus.conceptId, correct: verdict === "correct" };
}

/**
 * Did the student commit to an answer for the concept the duck just asked about? Only trace and
 * prediction concepts with a stored answer, only while the concept is open. After the L3 example
 * the student is answering a different set of values, so that turn is not compared.
 *
 * If they answer a different open trace ("you check 5, then 7, then 9") while the duck was on
 * another idea, that trace is what this turn is about.
 */
export function committedAnswer(
  text: string,
  run: SessionRun,
  defs: ConceptDef[],
  answers: StoredAnswer[],
): { conceptId: string; correct: boolean } | undefined {
  if (run.focusConceptId) {
    const direct = commitOn(run.focusConceptId, text, run, defs, answers, false);
    if (direct) return direct;
  }
  for (const concept of run.concepts) {
    if (concept.conceptId === run.focusConceptId) continue;
    const other = commitOn(concept.conceptId, text, run, defs, answers, true);
    if (other) return other;
  }
  return undefined;
}
