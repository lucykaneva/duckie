// Word and phrase lists the engine matches against (rules spec, section 3 and 5).
// These are lexicons, not tunable numbers. Numbers live in src/lib/duck/config.ts.
// All patterns run against normalized text: lowercase, straight apostrophes.

/** "I don't know" signal. Spec: "no idea", "I don't know", "not sure at all". */
export const DONT_KNOW_PATTERNS: RegExp[] = [
  /\b(?:i )?do(?:n'?t| not) know\b/,
  /\bdunno\b/,
  /\bno idea\b/,
  /\bno clue\b/,
  /\bnot sure at all\b/,
];

/**
 * Hedging. Spec: "I think", "maybe", "kind of", "or something".
 * "kinda" is the spoken form of "kind of". Each occurrence counts.
 */
export const HEDGE_PATTERNS: RegExp[] = [
  /\bi think\b/g,
  /\bmaybe\b/g,
  /\bkind of\b/g,
  /\bkinda\b/g,
  /\bor something\b/g,
];

/**
 * Filler words. Spec: only "um" and "uh". Transcripts stretch them
 * ("umm", "uhh") and sometimes write "uhm", so those count too.
 * Not fillers: "like", "so", "and" (those only extend the end-of-turn wait),
 * "er", "hmm".
 */
export const FILLER_WORD = /^(?:u+m+|u+h+m?)$/;

/** Look like a filler but are answers or exclamations: "uh-huh", "uh-oh". */
export const NOT_FILLER_PAIRS = /\buh[\s-]+(?:huh|oh)\b/g;

/** Explicit requests to skip. Must not fire on "you skip the left half". */
export const MOVE_ON_PATTERNS: RegExp[] = [
  /\b(?:let'?s|lets|can we|could we|shall we|i want to|i'd like to|i would like to|i'll|please|just)\s+(?:move on|skip)\b/,
  /\bskip (?:this|that)\b/,
  /\bmove on from (?:this|that)\b/,
  // The whole turn is the request: "skip", "move on please", "okay next".
  /^(?:ok(?:ay)?[,. ]+)?(?:skip|move on|next)(?: please)?[.!]*$/,
];

/**
 * Asking for help. Not a struggle signal; the ladder starts these at L3.
 * Second person only, so "let me explain it" (the student teaching) is not a request.
 */
export const HELP_REQUEST_PATTERNS: RegExp[] = [
  /\b(?:can|could|would|will) you (?:please )?(?:just )?(?:explain|help|tell me|show me|walk me through|give me)\b/,
  /\bplease (?:explain|help)\b/,
  /\bexplain (?:it|that|this) to me\b/,
  /\bhelp me\b/,
  /\bi need (?:some |a little )?help\b/,
  /\b(?:a|any|some) hints?\b/,
  /\b(?:i'm|i am|im) stuck\b/,
];
