import { DUCK } from "../duck/config";

// Fixed lines the duck speaks until Dev A's wordMove replaces them in B11. Code decides
// which move happens; these only fill in the words. All are 20 words or fewer with at most one question.

export const OPENING_LINE = "Ooh! Can you explain it to me? I'm just a duck.";
export const OFFER_SKIP_LINE = "Want to skip this one?";
export const ACK_LINE = "Got it.";
export const ACK_AFTER_EXPLAIN_LINE = "Okay, that makes sense now.";
export const ACK_SKIP_LINE = "Okay.";

// Brakes (spec section 5)
export const OPEN_PROMPT_LINE = "What's the next piece of it?";
export const CHECK_IN_LINE = "Keep going or wrap up?";
export const PAUSE_LINE = "I'll be here when you're ready.";

// Wrap-up. A proposal is a question and the session goes on if the student says no;
// the closing line is spoken once the student agrees, then POST /end gives the summary.
export const ALL_ASKED_PROPOSAL_LINE = "That's everything I wanted to ask. Ready to wrap up?";
export const LIMIT_PROPOSAL_LINE = "We've covered a lot. Ready to wrap up?";
export const WRAP_UP_LINE = "Okay, let's wrap up.";

// Spoken when the leak check blocks a line that would have said a stored answer.
export const LEAK_FALLBACK_LINE = "Let's slow down. Can you walk me through it step by step?";

export function wordCount(line: string): number {
  const trimmed = line.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Put an acknowledgement in front of the next line when the result still fits
 * the word limit; otherwise speak the line alone.
 */
export function withAck(ack: string | undefined, line: string, maxWords: number = DUCK.maxDuckWords): string {
  if (!ack) return line;
  const joined = `${ack} ${line}`;
  return wordCount(joined) <= maxWords ? joined : line;
}

/** "When it stops" becomes "when it stops"; names that start with a capitalised word or code are left alone. */
export function inSentence(name: string): string {
  const trimmed = name.trim().replace(/[.!?]+$/, "");
  return /^[A-Z][a-z]/.test(trimmed) ? trimmed[0].toLowerCase() + trimmed.slice(1) : trimmed;
}

/**
 * A celebration that names what the student did (spec section 6). Used when the
 * student got through after struggling, or caught a planted mistake unaided.
 * Falls back to a short generic line if the concept name makes it too long.
 */
export function celebrationLine(
  conceptName: string,
  caught: boolean,
  maxWords: number = DUCK.maxDuckWords,
): string {
  const named = caught
    ? `Ooh, you caught the mistake in ${inSentence(conceptName)}.`
    : `Ooh, nice. You got ${inSentence(conceptName)}.`;
  if (wordCount(named) <= maxWords) return named;
  return caught ? "Ooh, you caught that one." : "Ooh, nice. You got that one.";
}
