export const DUCK = {
  // turn-taking (section 2)
  endOfTurnSilenceMs: 1_800,
  unfinishedThoughtWaitMs: 4_000,
  bargeInStopMs: 300,
  // Only if /turn is still going after this. Grok's judge+wording is usually 2–4 s, so 1.5 s
  // made the duck say "Hmm, let me think" on every turn. 8 s is a stuck call, not a normal one.
  fillerAfterMs: 8_000,
  maxDuckWords: 20,

  // signal weights (section 3)
  weights: {
    dontKnow: 0.45, wrongTrace: 0.3, misconception: 0.3,
    conceptMissed: 0.3, contradiction: 0.3,
    silence: 0.25, vague: 0.25, hedging: 0.15, fillers: 0.1,
  },
  hedgingMinPerTurn: 2,
  fillerWordsPerUm: 8,

  // help ladder (section 4)
  levels: { L1: 0.25, L2: 0.45, L3: 0.6, L4: 0.8 },
  /**
   * The duck is a conversation, usually with no slides open. Off: it never mentions slides, and a level-2 hint is an
   * everyday question. On: level 2 points at the slide, as in the rules spec.
   */
  mentionSlides: false as boolean,
  maxMovesPerConcept: 3,
  failedAttemptsForL4: 3,

  // brakes (section 5)
  silenceRephraseMs: 8_000,
  silenceOfferSkipMs: 20_000,
  silencePauseMs: 45_000,
  maxQuestionStreak: 2,
  skipsBeforeCheckIn: 2,
  sessionMaxMs: 8 * 60_000,
  sessionMaxConcepts: 6,

  // celebration (section 6)
  earnedScore: 0.45,
  afterCelebrationMs: 1_500,

  // invitations (section 7)
  recallFirstDays: { misconception: 1, explainedTo: 1, skipped: 1, assisted: 2, owned: 4 },
  recallMaxDays: 30,
  inviteGapMs: 4 * 3_600_000,
  invitesPerDay: 2,
  afterUploadMs: 30 * 60_000,
  dismissedInviteMs: 24 * 3_600_000,
};

export type DuckConfig = typeof DUCK;

// Engine choices the rules spec does not give a number for (B9). Tune here, never in logic.
export const ENGINE = {
  /**
   * A turn this short with nothing judged is not an answer to a concept: it is "I'm back" after a pause,
   * or a reply like "keep going" to a check-in.
   */
  shortTurnMaxWords: 3,
  /**
   * "Okay, let's do that" is agreement, not an answer. A turn this short that only agrees
   * does not score and does not climb. A longer turn is the student actually talking.
   */
  readyTurnMaxWords: 8,
  /**
   * After a correct answer the duck gives one small hint and asks the student to say it back in their own words,
   * before moving on. Off = "Got it" and straight to the next question. Not used after an L4 explanation: that
   * already ended in a teach-back.
   */
  reinforceAfterCorrect: false,
  /**
   * Once the ladder is used up (3 moves, or the explanation has been given), a student who still asks for help or an
   * example gets this many more help moves before the duck offers to skip.
   */
  helpRequestMovesBeyondCap: 3,
  /**
   * A student question ("Is it log n?") means they need help. Only a short, single-sentence question counts, so a
   * long explanation that ends in "right?" is still scored as teaching. Without a question mark the cap is lower.
   */
  questionMaxWords: 15,
  questionNoMarkMaxWords: 8,
  /**
   * A sentence this long is its own claim. When a turn has two of these, the later one decides:
   * a right opening does not count if the ending states something else.
   */
  laterClaimMinWords: 6,
  /**
   * Words that may follow a covered quote (a short elaboration) and still count as the same claim.
   * More than this, and the quote is not the last thing they said.
   */
  coveredTailWords: 12,

  // Running a concept's reference code (B10). The code is written by the AI, so it runs in a locked-down child process.
  /** The script is stopped after this long (an infinite loop). */
  codeTimeoutMs: 1_000,
  /** The whole child process is killed after this long, whatever it is doing. */
  codeWallMs: 3_000,
  codeMemoryMb: 64,
  /** The answer, as JSON, may not be longer than this. */
  codeMaxOutputChars: 2_000,
};

// Upload and extraction (B8). Not part of the rules spec; tune here, never in logic.
export const EXTRACT = {
  /** A page with fewer non-space characters than this is treated as an image page. */
  minPageChars: 25,
  /** Largest PDF the server accepts. Vercel rejects request bodies over 4.5MB. */
  maxPdfBytes: 4_000_000,
  /** Largest single page image or photo the server accepts. */
  maxImageBytes: 3_500_000,
  maxPages: 40,
  /** Most concepts kept from one file. */
  maxConcepts: 15,
  /** Most characters of document text sent to the extraction prompt. */
  maxPromptChars: 60_000,
  /** Browser rendering of image pages (used by src/lib/extract/client.ts). */
  pageImageWidth: 1_200,
  pageImageQuality: 0.7,
  pagesInParallel: 5,
  /** The check question plus a 5-word acknowledgement must fit in maxDuckWords. */
  checkPromptMaxWords: 15,
  visionModel: "grok-4.20-non-reasoning",
  extractModel: "grok-4.20-non-reasoning",
  visionTimeoutMs: 40_000,
  // The extract route's maxDuration is 60s. Leave room to save concepts after Grok replies.
  extractTimeoutMs: 50_000,
  /** A document stuck extracting for longer than this is reported as failed. */
  extractStuckAfterMs: 5 * 60_000,
};

// Grok text calls made by Dev A's prompt functions (src/lib/prompts). Tune here, never in logic.
export const PROMPTS = {
  judgeModel: "grok-4.20-non-reasoning",
  /** Judge timeout. Filler only plays if /turn is still going after DUCK.fillerAfterMs. */
  judgeTimeoutMs: 4_000,
  judgeMaxTokens: 700,
  /** A judge quote with fewer words than this is dropped: one word is too easy to match by accident. */
  minQuoteWords: 2,

  /** wordMove: one fast call per attempt, with a hard cap on the total so the duck is never left waiting. */
  wordModel: "grok-4.20-non-reasoning",
  wordAttemptTimeoutMs: 2_500,
  wordTotalBudgetMs: 3_500,
  /** No point in a retry that has less than this long to finish. */
  wordMinRetryMs: 800,
  wordMaxTokens: 80,
  /** Some variety so the duck does not repeat itself, but not so much that it drifts off the task. */
  wordTemperature: 0.6,
  /** The student's words and the tone hint are cut to this many characters before they reach a prompt. */
  wordStudentCharsMax: 400,
  wordToneHintCharsMax: 160,
};

// The browser side of the voice loop (Dev A, src/lib/voice).
export const VOICE = {
  /** A server call that takes longer than this has failed. /turn is normally 1 to 4 s; 12 s is stuck. */
  requestTimeoutMs: 12_000,
  /** This many failed turns in a row and the duck stops the session instead of asking again. */
  maxFailedTurnsInARow: 3,
  /**
   * After the duck's samples leave the laptop, a Bluetooth speaker is still playing for about this long.
   * Mic audio in that window is the speaker, so it is not sent and it cannot cut the line off.
   */
  echoTailMs: 600,
  /** Ignore interruptions for this long after a line starts, so the speaker's attack is not the student. */
  bargeInSettleMs: 400,
  /** The student has to be this many times louder than the quiet room before we stop the duck. */
  bargeInOverFloor: 6,
  /** And at least this loud (0 to 1), so room noise cannot trip it. */
  bargeInMicPeak: 0.18,
};

// summarizeProfile (A11): how a turn log becomes a learner profile. Tune here, never in logic.
export const PROFILE = {
  model: "grok-4.20-non-reasoning",
  /** Runs after a session ends, not during a conversation, so it can take longer than a live call. */
  timeoutMs: 15_000,
  maxTokens: 900,
  temperature: 0.3,
  /** Most student turns sent to Grok, newest kept. */
  maxTurns: 40,
  /** Each turn is cut to this many characters before it reaches the prompt. */
  turnChars: 400,
  /** Longest sentence stored for calibration, pace, nagginess and tone. */
  fieldChars: 120,
  maxHabits: 4,
  maxDuckLearned: 5,
  /** A quote shown to the student is cut to its first words, so the panel stays readable. */
  quoteWordsMax: 12,

  /** Per-user config overrides never move a number further than this fraction from its default. */
  maxOverridePct: 0.25,
  /** Words per minute while speaking. Slower than this, or faster than the next one, changes the timing. */
  slowWpm: 95,
  fastWpm: 155,
  /** A turn with fillers or hedges counts as "pausing mid-thought" when this share of turns has them. */
  hesitantShare: 0.4,
  /** A quiet student: this many silence signals per student turn gives them longer before the duck speaks. */
  quietShare: 0.2,
  /** Accepted skips (in the log) before the duck follows up less. */
  skipsForLessNagging: 2,
  /** Calibration gap in points (confidence x 20 minus understanding) that counts as over- or under-confident. */
  calibrationGap: 15,
};
