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

/** Explicit requests to skip. Must not fire on "you skip the left half" or "why do I want to skip". */
export const MOVE_ON_PATTERNS: RegExp[] = [
  /\b(?:let'?s|lets|can we|could we|shall we|i'd like to|i would like to|i'll|please|just)\s+(?:move on|skip)\b/,
  // "I want to skip" is a request. "Why do I want to skip" is a complaint about the duck.
  /(?<!\bwhy (?:do|would) )\bi want to\s+(?:move on|skip)\b/,
  /\bskip (?:this|that)\b/,
  /\bmove on from (?:this|that)\b/,
  // The whole turn is the request: "skip", "move on please", "okay next".
  /^(?:ok(?:ay)?[,. ]+)?(?:skip|move on|next)(?: please)?[.!]*$/,
];

/** A plain "yes": the answer to "Want to skip this one?". Whole turn only. */
export const AFFIRMATIVE_PATTERN =
  /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|fine|please|go ahead|yes please|sure thing)[.!, ]*$/;

/**
 * Agreeing with a planted wrong claim ("My friend wrote lo = mid. Is that okay?").
 * "I think that's fine?" is the spec's turn. Rejecting the claim ("no, that loops") must not match.
 */
export const PLANTED_AGREE_PATTERNS: RegExp[] = [
  /\b(?:that(?:'s| is)|it(?:'s| is)) (?:fine|okay|ok|alright|all right)\b/,
  /\b(?:that|it) should (?:be )?(?:fine|okay|ok|work)\b/,
  /\bi think (?:that(?:'s| is)|it(?:'s| is)) (?:fine|okay|ok)\b/,
  /^(?:yes|yeah|yep|yup|sure|ok(?:ay)?|fine)(?: it is| that is)?[.!? ]*$/,
];

export const PLANTED_REJECT_PATTERNS: RegExp[] = [
  /\bnot (?:fine|okay|ok|alright)\b/,
  /\b(?:no|nope|nah|wrong|incorrect)\b/,
  /\b(?:loop|forever|never (?:move|stop|end))\b/,
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

/**
 * "What do you mean by pebbles?", "say that again", "I don't get the question". The student is asking
 * about the duck's last line, not answering it. Never a struggle signal.
 */
export const CLARIFY_PATTERNS: RegExp[] = [
  /\bwhat (?:do|did) you mean\b/,
  /\bwhat does (?:that|this|it) mean\b/,
  /\bwhat (?:are|were) you (?:asking|saying)\b/,
  /\bwhat was (?:that|the question)\b/,
  /\b(?:i )?(?:don'?t|do not) (?:understand|get) (?:the|your|that|this) (?:question|part)\b/,
  /\b(?:can|could) you (?:please )?(?:repeat|say) (?:that|it|the question)(?: again)?\b/,
  /\b(?:say|repeat) (?:that|it|the question) (?:again|one more time)\b/,
  /\bcome again\b/,
  /^(?:sorry|pardon|huh|what)[?.! ]*$/,
  // "What's a pebble?": a bare question about one or two words.
  /^(?:and )?what(?:'s| is| are) (?:a |an |the |my )?[a-z']+(?: [a-z']+)?\??$/,
];

/** A question the duck cannot answer: it has a question mark, or starts like one. */
export const QUESTION_START_PATTERN =
  /^(?:is|are|was|were|does|do|did|can|could|would|should|will|what|why|how|which|where|when|who)\b/;

/**
 * Asking to stop the session. Explicit requests only: "let's wrap up", "I want to stop",
 * or a turn that is just "wrap up" / "I'm done". "I'm done with halving" is the student explaining.
 */
export const WRAP_UP_PATTERNS: RegExp[] = [
  /\b(?:let'?s|lets|can we|could we|shall we|i want to|i'd like to|i would like to|please|time to)\s+(?:wrap(?: it| this| things)? up|call it (?:a day|quits)|end (?:the|this) session)\b/,
  /\b(?:let'?s|lets|can we|could we|shall we|i want to|i'd like to|i would like to|please|time to)\s+(?:stop|finish|end)(?: here| now| up| for (?:today|now))?[.!?]*$/,
  /^(?:(?:ok(?:ay)?|yes|yeah)[,. ]+)?(?:wrap(?: it| this)? up|(?:i'?m|i am) (?:done|finished)|that'?s (?:enough|all)|done|stop|finish)(?: please| for today| now)?[.!]*$/,
];

/** "Keep going", "one more", "not yet": the answer to "Keep going or wrap up?" or "Ready to wrap up?". */
export const KEEP_GOING_PATTERNS: RegExp[] = [
  /\bkeep (?:going|on)\b/,
  /\b(?:let'?s |lets )?(?:continue|carry on|go on)\b/,
  /\bone more\b/,
  /\bnot (?:yet|ready)\b/,
  /^(?:no|nope|nah)(?: thanks| thank you)?[.!, ]*$/,
];
