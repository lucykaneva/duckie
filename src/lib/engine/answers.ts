// Stored answers (B10): what the reference code returned, how a student's spoken answer is
// compared with it, and the leak check that keeps the duck from saying it first.
// Everything here is plain string and number handling. No code is executed.

import { detectDontKnow } from "./signals";

// ---------------------------------------------------------------------------------------
// What an answer can be

export type Expected =
  | { kind: "numbers"; values: number[] }
  | { kind: "text"; values: string[] }
  | { kind: "boolean"; value: boolean };

const MAX_ITEMS = 50;
const MAX_TEXT = 200;

/**
 * The answers we know how to check: a number, a list of numbers, a word or phrase, a list of
 * those, or true/false. Returns compact JSON, or null for anything else (objects, nested lists,
 * mixed lists, NaN, huge values).
 */
export function normalizeAnswer(json: string): string | null {
  const expected = parseExpected(json);
  if (!expected) return null;
  // Same shape in, same shape out: a number stays a number, a list stays a list.
  return JSON.stringify(JSON.parse(json));
}

export function parseExpected(json: string): Expected | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof value === "boolean") return { kind: "boolean", value };
  if (typeof value === "number") return Number.isFinite(value) ? { kind: "numbers", values: [value] } : null;
  if (typeof value === "string") {
    const text = value.trim();
    return text && text.length <= MAX_TEXT ? { kind: "text", values: [text] } : null;
  }
  if (Array.isArray(value) && value.length > 0 && value.length <= MAX_ITEMS) {
    if (value.every((v) => typeof v === "number" && Number.isFinite(v))) {
      return { kind: "numbers", values: value as number[] };
    }
    if (value.every((v) => typeof v === "string" && v.trim() && v.length <= MAX_TEXT)) {
      return { kind: "text", values: (value as string[]).map((v) => v.trim()) };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Reading numbers out of speech: "5, then 7", "twenty", "twenty-five", "1,000"

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const MAGNITUDES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000 };

/** Words that join numbers into one spoken list: "5 and 7", "5, then 7". */
const LINKS = new Set(["and", "then", "to", "next", "followed", "by"]);

type Item = { kind: "num"; value: number } | { kind: "link" } | { kind: "other" };

const TOKEN =
  /((?<![\w.])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])-?\d+(?:\.\d+)?)|([a-z']+)|([,;&]|->|→)|(\S)/g;

/** "Slide 7" names a page, not a value. */
const PAGE_REFERENCE = /\b(?:slide|page)s?\s*#?\d+/g;

function prepare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(PAGE_REFERENCE, " ")
    .replace(/([a-z])-(?=[a-z])/g, "$1 ");
}

/** Read a spoken number starting at words[i]. */
function readNumberWords(words: string[], i: number): { value: number; next: number } | null {
  let value: number;
  let j = i;
  const w = words[j];
  if (w === "a" && words[j + 1] in MAGNITUDES) {
    value = 1;
    j += 1;
  } else if (w in UNITS) {
    value = UNITS[w];
    j += 1;
  } else if (w in TENS) {
    value = TENS[w];
    j += 1;
    if (words[j] in UNITS && UNITS[words[j]] >= 1 && UNITS[words[j]] <= 9) {
      value += UNITS[words[j]];
      j += 1;
    }
  } else {
    return null;
  }
  while (words[j] in MAGNITUDES) {
    const magnitude = MAGNITUDES[words[j]];
    value *= magnitude;
    j += 1;
    // "two hundred fifty", "twenty five hundred" are rare in a spoken trace; read the common tail.
    if (magnitude === 100 && (words[j] in TENS || (words[j] in UNITS && UNITS[words[j]] > 0))) {
      const tail = readNumberWords(words, j);
      if (tail && tail.value < 100) {
        value += tail.value;
        j = tail.next;
      }
    }
  }
  return { value, next: j };
}

function scan(text: string): Item[] {
  const items: Item[] = [];
  // Separate the raw tokens first so number words can look at their neighbours.
  const tokens: { type: "num" | "word" | "link" | "other"; text: string }[] = [];
  for (const match of prepare(text).matchAll(TOKEN)) {
    if (match[1] !== undefined) tokens.push({ type: "num", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ type: "word", text: match[2] });
    else if (match[3] !== undefined) tokens.push({ type: "link", text: match[3] });
    else tokens.push({ type: "other", text: match[4] });
  }

  const loneOne = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "num") {
      items.push({ kind: "num", value: Number(t.text.replace(/,/g, "")) });
    } else if (t.type === "link") {
      items.push({ kind: "link" });
    } else if (t.type === "word") {
      // Only consecutive words can form one number ("twenty five").
      let end = i;
      while (end < tokens.length && tokens[end].type === "word") end += 1;
      const words = tokens.slice(i, end).map((x) => x.text);
      const read = readNumberWords(words, 0);
      if (read) {
        if (words[0] === "one" && read.next === 1) loneOne.add(items.length);
        items.push({ kind: "num", value: read.value });
        i += read.next - 1;
      } else if (LINKS.has(t.text)) {
        items.push({ kind: "link" });
      } else {
        items.push({ kind: "other" });
      }
    } else {
      items.push({ kind: "other" });
    }
  }

  // "one" on its own is mostly a pronoun ("that one", "one at a time"). It counts as a number only
  // when it sits next to another number in a list ("one, two, three").
  const neighbourIsNumber = (index: number, step: 1 | -1): boolean => {
    for (let k = index + step; k >= 0 && k < items.length; k += step) {
      if (items[k].kind === "link") continue;
      return items[k].kind === "num" && !loneOne.has(k);
    }
    return false;
  };
  return items.map((item, index) =>
    loneOne.has(index) && !neighbourIsNumber(index, 1) && !neighbourIsNumber(index, -1)
      ? { kind: "other" as const }
      : item,
  );
}

/** Every number in the text, in the order spoken. */
export function numbersIn(text: string): number[] {
  return scan(text).flatMap((item) => (item.kind === "num" ? [item.value] : []));
}

/**
 * Runs of numbers joined only by "and", "then", commas and the like: "1, 3, 5, 7, 9" is one run,
 * and "5 and 7, so" is another. Any other word ends the run.
 */
export function numberRuns(text: string): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];
  const close = () => {
    if (current.length > 0) runs.push(current);
    current = [];
  };
  for (const item of scan(text)) {
    if (item.kind === "num") current.push(item.value);
    else if (item.kind === "other") close();
  }
  close();
  return runs;
}

const same = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;
const sameList = (a: number[], b: number[]): boolean => a.length === b.length && a.every((v, i) => same(v, b[i]));

function isSubsequence(wanted: number[], seq: number[]): boolean {
  let at = 0;
  for (const v of seq) {
    if (at < wanted.length && same(v, wanted[at])) at += 1;
  }
  return at === wanted.length;
}

/** The same values, ignoring order and repeats. */
const sameSet = (a: number[], b: number[]): boolean =>
  a.every((v) => b.some((w) => same(v, w))) && b.every((v) => a.some((w) => same(v, w)));

// ---------------------------------------------------------------------------------------
// Comparing the student's answer

/**
 * - `correct`: the student committed to the stored answer.
 * - `wrong`: the student committed to something else (this is what adds the 0.3 "wrong trace" signal).
 * - `none`: the student did not commit to an answer we can read ("I don't know", "can you explain it?"),
 *   so nothing is judged. Never counted as wrong.
 */
export type Verdict = "correct" | "wrong" | "none";

const cleanWords = (text: string): string =>
  ` ${text.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim()} `;

const hasPhrase = (haystack: string, phrase: string): boolean => {
  const needle = cleanWords(phrase);
  return needle.trim().length > 0 && haystack.includes(needle);
};

/**
 * Numbers that are only named as missing ("6 is not in the list", "you will not have found 6")
 * are the target, not extra values they claim they checked.
 */
function stripAbsentNumbers(text: string): string {
  return text
    .replace(/\bnot (?:have )?found\s+-?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b(?:did not|didn't|never)\s+find\s+-?\d+(?:\.\d+)?\b/gi, " ")
    .replace(/\b-?\d+(?:\.\d+)?\s+(?:is not|isn'?t|was not|wasn'?t)\s+(?:in|there|found)\b/gi, " ")
    .replace(/\b-?\d+(?:\.\d+)?\s+(?:does not|doesn't)\s+exist\b/gi, " ");
}

/**
 * Compare a spoken answer with the stored one.
 *
 * Numbers: the student must name exactly the right values, and name them in the right order. They may
 * repeat a value ("after 7 there's nothing left, so just 5 and 7" is correct), but adding a value
 * ("5, then 7, then maybe 9") or reversing the order is wrong.
 *
 * Words: correct if every stored word or phrase is said, in order; a miss is `none` rather than `wrong`,
 * because a student can say the same idea in other words and we must not mark that down.
 *
 * True/false: the first "yes/true" or "no/false" the student says.
 */
export function compareAnswer(text: string, expectedJson: string): Verdict {
  const expected = parseExpected(expectedJson);
  if (!expected) return "none";

  if (expected.kind === "numbers") {
    const said = numbersIn(stripAbsentNumbers(text));
    if (said.length === 0) return "none";
    const right = sameSet(said, expected.values) && isSubsequence(expected.values, said);
    return right ? "correct" : "wrong";
  }

  if (expected.kind === "text") {
    const spoken = cleanWords(text);
    let from = 0;
    for (const phrase of expected.values) {
      const needle = cleanWords(phrase);
      const at = spoken.indexOf(needle, from);
      if (at === -1) return "none";
      from = at + needle.length - 1;
    }
    return "correct";
  }

  if (detectDontKnow(text)) return "none";
  const words = cleanWords(text).trim().split(" ");
  const first = words.find((w) => ["yes", "yeah", "yep", "true", "correct", "no", "nope", "false"].includes(w));
  if (!first) return "none";
  const saidYes = ["yes", "yeah", "yep", "true", "correct"].includes(first);
  return saidYes === expected.value ? "correct" : "wrong";
}

const SMALL_NUMBERS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty",
];

function sayNumber(n: number): string {
  if (Number.isInteger(n) && n >= 0 && n < SMALL_NUMBERS.length) return SMALL_NUMBERS[n];
  return String(n);
}

function capWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The list in a check prompt, like 1, 3, 5, 7, 9. The target ("looking for 6") is a separate number. */
function exampleList(checkPrompt: string): number[] | undefined {
  const runs = numberRuns(checkPrompt).filter((run) => run.length >= 3);
  if (runs.length === 0) return undefined;
  return [...runs].sort((a, b) => b.length - a.length)[0];
}

/**
 * The number they treated as the middle, spoken as a word ("three"), when it is in the list
 * and is not the middle. Null when they already named the middle, or there is no list.
 * This is not the stored answer. It only reads the list the duck already asked out loud.
 */
export function spokenMissWord(checkPrompt: string, studentText: string): string | null {
  const list = exampleList(checkPrompt);
  if (!list || list.length % 2 === 0) return null;
  const middle = list[Math.floor(list.length / 2)];
  const said = numbersIn(stripAbsentNumbers(studentText)).filter((n) => list.some((v) => same(v, n)));
  if (said.length === 0 || said.some((n) => same(n, middle))) return null;
  return sayNumber(said[0]);
}

/** They named the middle of the spoken list and nothing else. That is not a full trace. */
export function namesOnlyMiddle(checkPrompt: string, studentText: string): boolean {
  const list = exampleList(checkPrompt);
  if (!list || list.length % 2 === 0) return false;
  const middle = list[Math.floor(list.length / 2)];
  const said = numbersIn(stripAbsentNumbers(studentText));
  return said.length > 0 && said.every((n) => same(n, middle));
}

/**
 * Backup line if Grok cannot check the list. Grok writes the live line; this is what is spoken
 * when that check fails. The full stored trace is never spoken.
 */
export function middleMissLine(checkPrompt: string, studentText: string, lastLine = ""): string | null {
  if (!spokenMissWord(checkPrompt, studentText)) return null;
  const list = exampleList(checkPrompt)!;
  const middle = list[Math.floor(list.length / 2)];
  const ask = "Which numbers do you check?";
  const mid = sayNumber(middle);
  const wrong = spokenMissWord(checkPrompt, studentText)!;
  if (/\bisn'?t the middle\b/i.test(lastLine)) {
    return `${capWord(mid)} is the one in the middle. What would you check next?`;
  }
  return `${capWord(wrong)} isn't the middle. ${capWord(mid)} is. ${ask}`;
}

// ---------------------------------------------------------------------------------------
// The leak check

export interface SecretAnswer {
  /** The stored answer as JSON. */
  expectedAnswer: string;
  /** What the student has already been told: the concept's check question. Its own numbers are not a leak. */
  givenText?: string;
}

/**
 * Does this line say a stored answer out loud? Returns that answer, or null if the line is safe.
 *
 * Numbers: a run of numbers in the line that is exactly the answer ("you'd check 5 and 7") is a leak.
 * A longer run is not ("1, 3, 5, 7, 9" contains 5 and 7 in order but is the question's own list), and a
 * run that also appears in `givenText` is never a leak. "Slide 7" is a page, not a value. A single-number
 * answer is flagged whenever the line says that number on its own, which can block a harmless line that
 * mentions it; a blocked line is replaced by a safe one, so that mistake is on the safe side.
 *
 * Words: the stored word or phrase appearing in the line, unless the check question already says it.
 * True/false answers are never checked: "yes" and "no" appear in ordinary questions.
 */
export function findLeak(line: string, secrets: SecretAnswer[]): string | null {
  for (const secret of secrets) {
    const expected = parseExpected(secret.expectedAnswer);
    if (!expected || expected.kind === "boolean") continue;

    if (expected.kind === "numbers") {
      const given = secret.givenText ? numberRuns(secret.givenText) : [];
      const leaked = numberRuns(line).some(
        (run) => sameList(run, expected.values) && !given.some((g) => sameList(g, run)),
      );
      if (leaked) return secret.expectedAnswer;
    } else {
      const spoken = cleanWords(line);
      const given = secret.givenText ? cleanWords(secret.givenText) : "";
      const leaked =
        expected.values.every((phrase) => phrase.length >= 3 && hasPhrase(spoken, phrase)) &&
        !expected.values.every((phrase) => hasPhrase(given, phrase));
      if (leaked) return secret.expectedAnswer;
    }
  }
  return null;
}
