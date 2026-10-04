// judgeTurn: reads one finished student turn and returns STRUCTURE ONLY, never speech.
// Code decides what the structure means (scores, levels, moves). The rule that keeps it honest:
// any item without a quote that appears in the student's words is dropped before it leaves here.
import { PROMPTS } from "../duck/config";
import { claimSpans } from "../engine/signals";
import type { ConceptForJudge, JudgeResult } from "../duck/types";
import { findQuote } from "./quotes";
import { AiError, chat, type FetchLike } from "./xai";

export interface JudgeInput {
  text: string;
  concepts: ConceptForJudge[];
  explanationTurnEnded: boolean;
  /** The duck's last line. A short reply like "that's fine" is about this, not a new explanation. */
  duckAsked?: {
    conceptId: string;
    line: string;
    plantsMisconception?: boolean;
    /** The question that stated a list, when this idea opened with one. Not a stored answer. */
    listInQuestion?: string;
  };
  /** Recent duck and student lines, oldest first. Quotes still have to come from this turn. */
  conversation?: string;
}

export interface JudgeOptions {
  fetchImpl?: FetchLike;
  model?: string;
  timeoutMs?: number;
}

const SYSTEM_PROMPT = `You are a strict grader inside a study tool. A student is explaining a topic out loud to a toy duck. You read ONE finished turn of what they said and report what it shows about each concept in a fixed list. You never write anything for the student or the duck. Reply with one JSON object and nothing else.

The text is a speech transcript: ignore missing punctuation and small recognition mistakes.

Go through the concepts one by one, in the order given, and return one entry for EVERY concept:
{"concepts": [
  {"conceptId": "...", "covered": null, "misconception": null, "vague": null, "contradiction": null}
]}

Each field is either null or evidence taken from the student's text:
- covered: a quote where the student explains THIS concept correctly, in their own words. Naming it is not enough, and a quote about a different concept does not count.
- misconception: a quote where the student states a belief that matches, or means the same as, one of THIS concept's known misconceptions, or is clearly wrong about this concept.
- vague: a quote where the student clearly talks about THIS concept but says nothing specific ("it just works", "it finds it fast"). Never use vague for a concept the student did not talk about.
- contradiction: two quotes, in the order said, where the student says things about THIS concept that cannot both be true: ["first quote", "second quote"].

Rules:
- Every quote is copied word for word from the student's text. Never paraphrase, correct or reorder it. If you cannot quote it, use null.
- If the student said nothing about a concept, all four fields are null. That is the normal case for most concepts in a short turn.
- Each quote should be the shortest stretch of words that shows the point, usually a clause.
- A quote belongs to the one concept it is about. Do not reuse a quote for several concepts unless it really is about each.
- When unsure, use null. A few certain items are better than many guesses.
- Use only the conceptId values you are given.
- "I'm not sure", "I don't know", "no idea" or a question is NEVER a misconception and is not agreement. Use null.
- If you are told the duck just asked a planted wrong claim and the student agrees ("that's fine", "yes", "that should work") without correcting it, that is a misconception for that concept. Quote the student's words. A correction ("no, that loops") is covered, not a misconception.
- If duckJustAsked contains an example, a list, or a claim, and the student's words contradict that example, misconception is their exact words. Do not write the correction. Do not assume the subject is a list or a middle unless the question is about that.
- Earlier turns are only for understanding what was asked. Every quote is still copied from studentText, never from the earlier lines.
- Read the turn in order. The last thing they say about a concept wins. They often start right and then talk themselves into a wrong method. If a later sentence replaces or walks back an earlier one, covered is null and misconception is a quote from that later part. Do not mark covered from an opening the ending gives up.
- lastClaim, when present, is that later part. Judge it on its own. If it states a different or wrong idea, it wins over anything earlier in studentText.

Example where the ending wins (a different topic). Student: "Plants make food from light. Actually they mostly eat soil, so the light does not matter."
Answer: {"concepts": [
  {"conceptId": "c_1", "covered": null, "misconception": "they mostly eat soil", "vague": null, "contradiction": null}
]}

Example (a different topic). Concepts: c_1 "Sunlight", c_2 "Chlorophyll" (known misconception: "plants eat soil"), c_3 "Stomata".
Student: "Plants make food from light. They mostly eat soil I think, and the green stuff is somehow involved."
Answer: {"concepts": [
  {"conceptId": "c_1", "covered": "Plants make food from light", "misconception": null, "vague": null, "contradiction": null},
  {"conceptId": "c_2", "covered": null, "misconception": "They mostly eat soil", "vague": "the green stuff is somehow involved", "contradiction": null},
  {"conceptId": "c_3", "covered": null, "misconception": null, "vague": null, "contradiction": null}
]}`;

function emptyResult(): JudgeResult {
  return { covered: [], missed: [], misconceptions: [], contradictions: [], vague: [] };
}

/** Words that only express uncertainty. A quote made of nothing else says nothing wrong about the topic. */
const UNCERTAINTY_WORDS = new Set(
  "i im i'm am have not no sure idea clue dont don't do know dunno um uh hmm maybe think guess kind of a bit really so well honestly actually just still".split(
    " ",
  ),
);

/** "I am not sure", "no idea", "hmm I don't know": not a belief, so never a misconception. */
export function isOnlyUncertainty(quote: string): boolean {
  const words = quote
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .split(/[^a-z']+/)
    .filter(Boolean);
  return words.every((w) => UNCERTAINTY_WORDS.has(w));
}

/**
 * Turns whatever Grok returned into a JudgeResult that obeys the quote rule. Pure, so it is easy to test.
 * `missed` is decided here, by code: once the explanation turn has ended, a concept with no surviving
 * evidence of any kind is missed. Grok is never asked to decide that.
 */
export function cleanJudgeResult(raw: unknown, input: JudgeInput): JudgeResult {
  const result = emptyResult();
  const entries =
    typeof raw === "object" && raw !== null && Array.isArray((raw as { concepts?: unknown }).concepts)
      ? ((raw as { concepts: unknown[] }).concepts as unknown[])
      : [];

  const known = new Set(input.concepts.map((c) => c.id));
  const evidence = new Set<string>(); // concepts with at least one surviving item
  const done = new Set<string>(); // first entry per concept wins

  for (const entry of entries) {
    if (typeof entry !== "object" || entry === null) continue;
    const item = entry as Record<string, unknown>;
    const conceptId = item.conceptId;
    if (typeof conceptId !== "string" || !known.has(conceptId) || done.has(conceptId)) continue;
    done.add(conceptId);

    const covered = findQuote(input.text, item.covered);
    if (covered) result.covered.push({ conceptId, quote: covered });

    const misconception = findQuote(input.text, item.misconception);
    if (misconception && !isOnlyUncertainty(misconception)) result.misconceptions.push({ conceptId, quote: misconception });

    const vague = findQuote(input.text, item.vague);
    if (vague) result.vague.push({ conceptId, quote: vague });

    if (Array.isArray(item.contradiction) && item.contradiction.length === 2) {
      const first = findQuote(input.text, item.contradiction[0]);
      const second = findQuote(input.text, item.contradiction[1]);
      if (first && second && first.toLowerCase() !== second.toLowerCase()) {
        result.contradictions.push({ conceptId, quotes: [first, second] });
      }
    }

    if (covered || misconception || vague || result.contradictions.some((c) => c.conceptId === conceptId)) {
      evidence.add(conceptId);
    }
  }

  if (input.explanationTurnEnded) {
    result.missed = input.concepts.filter((c) => !evidence.has(c.id)).map((c) => ({ conceptId: c.id }));
  }
  return result;
}

/**
 * Throws AiError when Grok is unavailable, slow or returns something unusable, so the caller can
 * fall back to code-only signals. It never returns a made-up "nothing found" for a failed call.
 */
function lastClaim(text: string): string | undefined {
  const spans = claimSpans(text);
  if (spans.length < 2) return undefined;
  const last = spans[spans.length - 1];
  return text.slice(last.start, last.end).trim();
}

export async function judgeTurn(input: JudgeInput, options: JudgeOptions = {}): Promise<JudgeResult> {
  if (!input.text.trim() || input.concepts.length === 0) return emptyResult();

  const ending = lastClaim(input.text);
  const content = await chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          explanationTurnEnded: input.explanationTurnEnded,
          concepts: input.concepts.map(({ id, name, misconceptions }) => ({ id, name, misconceptions })),
          studentText: input.text,
          ...(ending ? { lastClaim: ending } : {}),
          ...(input.duckAsked
            ? {
                duckJustAsked: {
                  conceptId: input.duckAsked.conceptId,
                  line: input.duckAsked.line,
                  plantedWrongClaim: input.duckAsked.plantsMisconception === true,
                  ...(input.duckAsked.listInQuestion ? { listInQuestion: input.duckAsked.listInQuestion } : {}),
                },
              }
            : {}),
          ...(input.conversation?.trim() ? { conversation: input.conversation.trim() } : {}),
        }),
      },
    ],
    {
      model: options.model ?? PROMPTS.judgeModel,
      timeoutMs: options.timeoutMs ?? PROMPTS.judgeTimeoutMs,
      maxTokens: PROMPTS.judgeMaxTokens,
      json: true,
      fetchImpl: options.fetchImpl,
    },
  );

  let raw: unknown;
  try {
    // json_object mode should return bare JSON; tolerate stray text or code fences around it.
    raw = JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1));
  } catch {
    throw new AiError("bad_output", "Grok did not return JSON");
  }
  return cleanJudgeResult(raw, input);
}
