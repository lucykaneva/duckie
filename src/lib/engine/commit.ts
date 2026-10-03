import { compareAnswer } from "./answers";
import type { StoredAnswer } from "./guard";
import type { ConceptDef, SessionRun } from "./turn";

/**
 * Did the student commit to an answer for the concept the duck just asked about? Only trace and
 * prediction concepts with a stored answer, only while the concept is open. After the L3 example
 * the student is answering a different set of values, so that turn is not compared.
 */
export function committedAnswer(
  text: string,
  run: SessionRun,
  defs: ConceptDef[],
  answers: StoredAnswer[],
): { conceptId: string; correct: boolean } | undefined {
  const focus = run.concepts.find((c) => c.conceptId === run.focusConceptId);
  const def = defs.find((d) => d.id === run.focusConceptId);
  const stored = answers.find((a) => a.conceptId === run.focusConceptId);
  if (!focus || !def || !stored || def.kind === "explain") return undefined;
  if (focus.skipped || (focus.state !== "not_yet" && focus.state !== "misconception")) return undefined;
  if (focus.levelReached === "L3") return undefined;
  const verdict = compareAnswer(text, stored.expectedAnswer);
  return verdict === "none" ? undefined : { conceptId: focus.conceptId, correct: verdict === "correct" };
}
