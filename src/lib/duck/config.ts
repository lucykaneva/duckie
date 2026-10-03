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
