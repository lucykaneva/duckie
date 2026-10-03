import { DUCK } from "../duck/config";

// B7 wording stubs. Dev A's wordMove replaces these in B11; until then the duck
// speaks the concept's precomputed line for the level, plus these fixed lines.

export const OPENING_LINE = "Ooh! Can you explain it to me? I'm just a duck.";
export const OFFER_SKIP_LINE = "Want to skip this one?";
export const WRAP_UP_LINE = "That's everything I wanted to ask. Ready to wrap up?";
export const ACK_LINE = "Got it.";
export const ACK_AFTER_EXPLAIN_LINE = "Okay, that makes sense now.";
export const ACK_SKIP_LINE = "Okay.";

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
