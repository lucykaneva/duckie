import { DUCK } from "../duck/config";

// Spoken lines the engine owns. Grok may reword some of these; if it cannot, these are what
// the student hears. Short, warm, no screen, at most one question.

/** Used when there is no topic yet. Prefer `openingLine(topic)` once they picked one. */
export const OPENING_LINE = "What do you want to talk through?";
/** After they say they forgot: a smaller first piece, never "walk me through it" again. */
export const AFTER_FORGET_LINE = "That's okay. What's the first bit you do remember?";
/** They said "okay" and did not answer. Ask them to actually try. Never "let's try that." */
export const AGREE_HOLD_LINE = "Mm. So what do you think happens?";
export const AGREE_HOLD_AGAIN_LINE = "Take a guess. I won't tell anyone.";

/** The 20 s silence offer. The ladder's offer is `offerSkipLine`, which can name a slide. */
export const OFFER_SKIP_LINE = "Want to leave this one for later?";

/**
 * The offer when the ladder is used up and the student is still stuck. With mentionSlides off (the normal
 * conversation) it does not name a slide. A plain yes moves on, and the idea is marked to revisit.
 */
export function offerSkipLine(slide?: number): string {
  if (!DUCK.mentionSlides || slide === undefined || slide <= 0) {
    return "This one's tricky. Want to leave it for now and come back to it?";
  }
  return `This one's tricky. Want to look at slide ${slide} later and move on?`;
}

/** Opening that names the topic they already chose. */
function spokenTopic(topic?: string): string {
  const name = topic?.replace(/\s+/g, " ").trim() ?? "";
  if (!name) return "";
  return /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

export function openingLine(topic?: string): string {
  const name = spokenTopic(topic);
  if (name) {
    const named = `I don't really get ${name} yet. How does it work?`;
    if (wordCount(named) <= DUCK.maxDuckWords) return named;
  }
  return OPENING_LINE;
}

/** A later invite must not repeat the last line. */
export function nextInviteLine(topic: string | undefined, lastLine: string): string {
  const name = spokenTopic(topic);
  const first = openingLine(name);
  const hey = name ? `Hey. How does ${name} work?` : AFTER_FORGET_LINE;
  if (!lastLine || lastLine === first) {
    return wordCount(hey) <= DUCK.maxDuckWords ? hey : AFTER_FORGET_LINE;
  }
  return AFTER_FORGET_LINE;
}

export const ACK_LINE = "Got it.";
/** Backup for the reinforce move (wordMove normally writes it from the student's own words). */
export const REINFORCE_LINE = "Got it. Can you say that once more in your own words?";
export const ACK_AFTER_EXPLAIN_LINE = "Okay, that makes sense now.";
export const ACK_SKIP_LINE = "Okay.";

/** First silence: a soft check, not another question. */
export const WAIT_LINE = "Take your time.";

// Brakes (spec section 5)
export const OPEN_PROMPT_LINE = "What's the next piece of it?";
/** They explained and nothing was wrong. Stay with what they said, and ask one small question. */
export const REFLECT_LINE = "Can you say a little more about that part?";
export const CHECK_IN_LINE = "Want to keep going, or stop here?";
export const PAUSE_LINE = "I'll be here when you're ready.";

// Wrap-up. A proposal is a question and the session goes on if the student says no;
// the closing line is spoken once the student agrees, then POST /end gives the summary.
export const ALL_ASKED_PROPOSAL_LINE = "That's all I was curious about. Want to stop here?";
export const LIMIT_PROPOSAL_LINE = "We've talked a while. Want to stop here?";
export const WRAP_UP_LINE = "Okay, let's wrap up.";
// The student answered a proposal with a question. Turn it back lightly; never "great question".
export const ASK_AGAIN_PROPOSAL_LINE = "Take a guess, or shall we wrap up?";
export const ASK_AGAIN_CHECK_IN_LINE = "Take a guess, or shall we keep going?";

// Spoken when the leak check blocks a line that would have said a stored answer.
export const LEAK_FALLBACK_LINE = "Let's slow down. Can you take it step by step?";

const STUDENT_NOUNS = ["list", "middle", "half", "sorted", "order", "left", "right"];

/** A fallback the student can hear: their noun if they named one, otherwise the warm smaller piece. */
export function smallerPieceLine(text: string): string {
  const noun = STUDENT_NOUNS.find((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
  if (noun === "list") return "That's okay. You mentioned a list. What's one thing about it?";
  if (noun) {
    const line = `That's okay. You mentioned ${noun}. What's one thing about that?`;
    if (wordCount(line) <= DUCK.maxDuckWords) return line;
  }
  return AFTER_FORGET_LINE;
}

/** Spoken when a stored line uses an example the student never brought up. Uses their concept, not a fixed topic. */
export function pebbleFree(line: string, conceptName?: string): string {
  if (!/\bpebbles?\b/i.test(line)) return line;
  const name = conceptName?.replace(/\s+/g, " ").trim() ?? "";
  if (name && !/\bpebbles?\b/i.test(name)) {
    const spoken = /^[A-Z][a-z]/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
    const question = `What's one thing about ${spoken} that has to be true?`;
    if (wordCount(question) <= DUCK.maxDuckWords) return question;
  }
  return "What's one thing that has to be true first?";
}

/**
 * The line may be spoken to this student. It must not introduce pebbles, "search space",
 * or numbers they never said.
 */
export function lineFitsStudent(line: string, student: string): boolean {
  const off = /\b(?:pebbles?|search space)\b/i;
  if (off.test(line) && !off.test(student)) return false;
  const said = student.toLowerCase();
  const nums =
    line.match(/\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty|hundred|thousand|million)\b/gi) ??
    [];
  return nums.every((n) => said.includes(n.toLowerCase()));
}

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
 * Rare, specific praise: name exactly what they did. Used after earned struggle, or when they
 * catch a planted mistake unaided. Never "great job".
 */
export function celebrationLine(
  conceptName: string,
  caught: boolean,
  maxWords: number = DUCK.maxDuckWords,
): string {
  const named = caught
    ? `Mm. You caught that about ${inSentence(conceptName)} yourself.`
    : `Mm. You just got ${inSentence(conceptName)}.`;
  if (wordCount(named) <= maxWords) return named;
  return caught ? "Mm. You caught that one yourself." : "Mm. You just explained it yourself.";
}
