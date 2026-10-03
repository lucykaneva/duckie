// The quote rule: a judge item whose quote does not appear in the student's turn text is dropped.
// Matching is by whole words, ignoring case, punctuation and spacing, because the text is a speech
// transcript and a model often re-punctuates a quote. The words themselves must be the student's.
import { PROMPTS } from "../duck/config";

interface Normalized {
  norm: string;
  /** For each character of `norm`, the index of the matching character in the original text. */
  map: number[];
}

const WORD_CHAR = /[\p{L}\p{N}']/u;

function normalize(text: string): Normalized {
  let norm = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    if (c === "\u2019" || c === "\u2018") c = "'"; // curly apostrophes
    if (WORD_CHAR.test(c)) {
      norm += c.toLowerCase();
      map.push(i);
    } else if (norm.length > 0 && norm[norm.length - 1] !== " ") {
      norm += " ";
      map.push(i);
    }
  }
  return { norm, map };
}

function wordCount(normalized: string) {
  return normalized.split(" ").filter(Boolean).length;
}

/**
 * Returns the student's exact words for this quote, or null if the quote is not in the text
 * (or is too short to count). The returned string is a slice of `text`, so it is always verbatim.
 */
export function findQuote(text: string, quote: unknown): string | null {
  if (typeof quote !== "string") return null;
  const q = normalize(quote).norm.trim();
  if (wordCount(q) < PROMPTS.minQuoteWords) return null;

  const { norm, map } = normalize(text);
  let from = 0;
  while (from <= norm.length) {
    const at = norm.indexOf(q, from);
    if (at === -1) return null;
    const before = at === 0 || norm[at - 1] === " ";
    const afterIndex = at + q.length;
    const after = afterIndex >= norm.length || norm[afterIndex] === " ";
    if (before && after) {
      return text.slice(map[at], map[afterIndex - 1] + 1);
    }
    from = at + 1; // matched inside a longer word ("sort" in "sorted"); keep looking
  }
  return null;
}
