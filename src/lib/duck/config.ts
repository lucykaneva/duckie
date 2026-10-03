export const DUCK = {
  // turn-taking (section 2)
  endOfTurnSilenceMs: 1_200,
  unfinishedThoughtWaitMs: 3_000,
  bargeInStopMs: 300,
  fillerAfterMs: 1_500,
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
  extractTimeoutMs: 90_000,
  /** A document stuck extracting for longer than this is reported as failed. */
  extractStuckAfterMs: 5 * 60_000,
};

// Grok text calls made by Dev A's prompt functions (src/lib/prompts). Tune here, never in logic.
export const PROMPTS = {
  judgeModel: "grok-4.20-non-reasoning",
  /** The judge shares the 1.5 s filler window with wording, so it gets little time. */
  judgeTimeoutMs: 4_000,
  judgeMaxTokens: 700,
  /** A judge quote with fewer words than this is dropped: one word is too easy to match by accident. */
  minQuoteWords: 2,
};
