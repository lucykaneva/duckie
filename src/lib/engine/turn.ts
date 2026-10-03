import { DUCK, ENGINE } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type {
  ConceptKind,
  ConceptProgress,
  ConceptState,
  DuckMove,
  JudgeResult,
  Level,
  MoveKind,
  SessionState,
} from "../duck/types";
import { mustOpenUp, nextStreak, sessionLimit, skipCheckInDue } from "./brakes";
import { feedbackFor } from "./celebration";
import { chooseLevel, higherLevel, stateAfterResolve } from "./ladder";
import { addSignals, collectSignals, judgeSignals, quoteAppears } from "./score";
import {
  detectAffirmative,
  detectClarification,
  detectHelpRequest,
  detectKeepGoing,
  detectMoveOn,
  detectQuestion,
  detectTextSignals,
  detectWrapUpRequest,
  tokenize,
} from "./signals";
import type { SignalKind } from "./signals";
import {
  ACK_SKIP_LINE,
  ALL_ASKED_PROPOSAL_LINE,
  ASK_AGAIN_CHECK_IN_LINE,
  ASK_AGAIN_PROPOSAL_LINE,
  CHECK_IN_LINE,
  LIMIT_PROPOSAL_LINE,
  OFFER_SKIP_LINE,
  OPENING_LINE,
  OPEN_PROMPT_LINE,
  WRAP_UP_LINE,
  celebrationLine,
  withAck,
} from "./wording";

export type HelpLevel = Exclude<Level, "L0">;

/** What the engine knows about a concept. Never includes reference code or answers. */
export interface ConceptDef {
  id: string;
  topic: string;
  name: string;
  slide: number;
  kind: ConceptKind;
  misconceptions: string[];
  /** The question the duck opens the concept with (the trace question, the planted misconception). */
  checkPrompt: string | null;
  /** The check question states a wrong claim for the student to catch ("My friend wrote lo = mid..."). */
  plantsMisconception?: boolean;
  /** Precomputed lines, used until Dev A's wordMove is wired in. */
  fallbackQuestions: Partial<Record<HelpLevel, string>>;
}

/** One concept's live state in a session. Maps to a concept_state row. */
export interface ConceptRun {
  conceptId: string;
  state: ConceptState;
  /** Struggle score, 0 to 1 (B6). */
  score: number;
  /** Highest help level the duck has used on this concept. L0 means no help yet. */
  levelReached: Level;
  /** Duck moves on this concept, the opening check question included. */
  moves: number;
  failedAttempts: number;
  skipped: boolean;
  celebrated: boolean;
}

/** What the duck is waiting for the student to answer, apart from a content question. */
export type PendingAsk = "check_in" | "wrap_proposal";

export interface SessionRun {
  /** In deck order (slide, then id). */
  concepts: ConceptRun[];
  /** The concept the duck last asked about. */
  focusConceptId: string | null;
  lastMoveKind: MoveKind | null;
  /** Finished student turns so far. */
  turnCount: number;
  /** What the duck last said that expects an answer; a rephrase after silence repeats it. */
  lastLine: string;
  /** Back-to-back duck questions with no acknowledgement between (the question-streak brake). */
  questionStreak: number;
  /** The "Keep going or wrap up?" check after two skips has been asked (it is asked once). */
  skipCheckInAsked: boolean;
  /** The duck has proposed wrapping up (it is proposed once). */
  wrapUpProposed: boolean;
  pending: PendingAsk | null;
  /** The student agreed to wrap up; the client now calls POST /end. */
  closing: boolean;
  /** Epoch ms the session started, and the pause bookkeeping that keeps pauses out of the 8-minute limit. */
  startedAtMs: number;
  pausedAtMs: number | null;
  pausedMs: number;
  /** The highest silence step (1 = 8 s, 2 = 20 s, 3 = 45 s) handled since the student last spoke. */
  silenceStep: 0 | 1 | 2 | 3;
  /** Trace and prediction concepts the student has given an answer to. Until then the leak check guards the answer. */
  committed: string[];
  /** Spoken /end summary, set once when the session ends. */
  closingLine?: string;
}

export interface TurnInput {
  text: string;
  /** Dev A's judgeTurn result (an empty result until it is wired in). */
  judge: JudgeResult;
  /** The code runner's verdict on a committed trace or prediction (B10). */
  answer?: { conceptId: string; correct: boolean };
  /** When the turn finished, in epoch ms. Used for the session-length brake. Defaults to the session start. */
  nowMs?: number;
}

export interface ResolvedConcept {
  conceptId: string;
  state: ConceptState;
  /** Score before the success reset. Celebration checks this against DUCK.earnedScore. */
  previous: number;
  levelReached: Level;
}

export interface TurnOutcome {
  session: SessionRun;
  move: DuckMove;
  /** Signals that counted this turn (for the decision log). */
  signals: SignalKind[];
  /** Score of the concept that was evaluated (or of the one the duck asked next). */
  scoreAfter: number;
  resolved: ResolvedConcept[];
}

const isOpen = (c: ConceptRun): boolean =>
  !c.skipped && (c.state === "not_yet" || c.state === "misconception");

const progress = (concepts: ConceptRun[]): ConceptProgress[] =>
  concepts.map((c) => ({ id: c.conceptId, state: c.state, score: c.score }));

/** A fresh session: every concept Not yet, nothing asked. */
export function freshSession(defs: ConceptDef[], startedAtMs = 0): SessionRun {
  return {
    concepts: defs.map((d) => ({
      conceptId: d.id,
      state: "not_yet",
      score: 0,
      levelReached: "L0",
      moves: 0,
      failedAttempts: 0,
      skipped: false,
      celebrated: false,
    })),
    focusConceptId: null,
    lastMoveKind: null,
    turnCount: 0,
    lastLine: OPENING_LINE,
    questionStreak: 0,
    skipCheckInAsked: false,
    wrapUpProposed: false,
    pending: null,
    closing: false,
    startedAtMs,
    pausedAtMs: null,
    pausedMs: 0,
    silenceStep: 0,
    committed: [],
  };
}

/** True until the student has actually started teaching (opening + "hello" do not count). */
export function hasNotStartedTeaching(session: SessionRun): boolean {
  return session.concepts.every((c) => c.moves === 0 && c.state === "not_yet" && c.score === 0);
}

/** Grok found they talked about the topic, or they committed a trace/prediction answer. */
export function taughtThisTurn(
  judge: JudgeResult,
  answer?: { conceptId: string; correct: boolean },
): boolean {
  return (
    judge.covered.length > 0 ||
    judge.misconceptions.length > 0 ||
    judge.contradictions.length > 0 ||
    judge.vague.length > 0 ||
    answer !== undefined
  );
}

/** The first thing the duck says (returned by POST /api/sessions). */
export function openingMove(defs: ConceptDef[]): DuckMove {
  return {
    kind: "open",
    level: "L0",
    conceptId: defs[0]?.id ?? "",
    line: OPENING_LINE,
    sessionState: "active",
    concepts: progress(freshSession(defs).concepts),
  };
}

interface PlannedMove {
  kind: MoveKind;
  level: Level;
  line: string;
  /** The concept this move is about and counts a move against; undefined for moves that are not about one. */
  concept?: ConceptRun;
  /** The concept id to report when `concept` is not set (open prompts stay on the focus concept). */
  conceptId?: string;
  /** Counts as a help level on the concept (L1 to L4). */
  help: boolean;
  sessionState: SessionState;
  /** Set when this move asks something other than a content question. */
  pending?: PendingAsk;
  /** The duck is proposing to wrap up (all concepts asked, or a session limit). */
  proposal?: boolean;
  /** The student has agreed to wrap up; this is the closing line. */
  close?: boolean;
}

const judgeIsEmpty = (j: JudgeResult): boolean =>
  j.covered.length === 0 &&
  j.missed.length === 0 &&
  j.misconceptions.length === 0 &&
  j.contradictions.length === 0 &&
  j.vague.length === 0;

/**
 * Process one finished student turn: update every open concept's score, resolve
 * or skip concepts, then make exactly one move. Pure; the caller loads and saves state.
 *
 * Order of precedence (brakes override the ladder, spec section 5):
 *   1. the session is closing, or the student asks to wrap up
 *   2. the student answers a wrap-up proposal or the two-skip check-in
 *   3. the first turn back after a pause that is only "I'm back"
 *   4. the ladder (skip, resolve, struggle) picks the next move
 *   5. two-skip check-in, session limit, then question streak may replace that move
 *   6. a celebration goes first, and the planned move follows as `then`
 */
export function processTurn(
  defs: ConceptDef[],
  session: SessionRun,
  input: TurnInput,
  config: DuckConfig = DUCK,
): TurnOutcome {
  const defById = new Map(defs.map((d) => [d.id, d]));
  const concepts: ConceptRun[] = session.concepts.map((c) => ({ ...c }));
  const orderOf = new Map(concepts.map((c, i) => [c.conceptId, i]));
  const text = input.text;
  const nowMs = input.nowMs ?? session.startedAtMs;

  // Time: a pause does not count toward the 8-minute limit.
  const wasPaused = session.pausedAtMs !== null;
  const pausedMs = session.pausedMs + (wasPaused ? Math.max(0, nowMs - (session.pausedAtMs as number)) : 0);
  const activeMs = Math.max(0, nowMs - session.startedAtMs - pausedMs);

  // "Missed" only after Grok sees they actually taught something. A hello is not a miss.
  const explanationTurnEnded = hasNotStartedTeaching(session) && taughtThisTurn(input.judge, input.answer);

  const focusRun = concepts.find((c) => c.conceptId === session.focusConceptId);
  const focus = focusRun && isOpen(focusRun) ? focusRun : undefined;

  const defOf = (c: ConceptRun): ConceptDef | undefined => defById.get(c.conceptId);
  const fallbackConceptId = session.focusConceptId ?? concepts[0]?.conceptId ?? "";
  const finishedConcepts = (): number => concepts.filter((c) => !isOpen(c)).length;

  /** The state every outcome starts from: this turn counted, the pause (if any) over, silence steps reset. */
  const carried = (): SessionRun => ({
    ...session,
    concepts,
    turnCount: session.turnCount + 1,
    pausedAtMs: null,
    pausedMs,
    silenceStep: 0,
  });

  const closeOutcome = (): TurnOutcome => {
    const move: DuckMove = {
      kind: "wrap_up",
      level: "L0",
      conceptId: fallbackConceptId,
      line: WRAP_UP_LINE,
      sessionState: "wrapping_up",
      concepts: progress(concepts),
    };
    return {
      session: { ...carried(), lastMoveKind: "wrap_up", lastLine: WRAP_UP_LINE, pending: null, closing: true, questionStreak: 0 },
      move,
      signals: [],
      scoreAfter: focus?.score ?? 0,
      resolved: [],
    };
  };

  // 1. Already closing, or the student asks to wrap up.
  if (session.closing || detectWrapUpRequest(text)) return closeOutcome();

  // 1b. They have not started teaching. Do not quiz; Grok replies to whatever they said.
  if (
    hasNotStartedTeaching(session) &&
    !taughtThisTurn(input.judge, input.answer) &&
    !detectMoveOn(text) &&
    !detectHelpRequest(text)
  ) {
    const move: DuckMove = {
      kind: "open",
      level: "L0",
      conceptId: fallbackConceptId,
      line: OPENING_LINE,
      sessionState: "active",
      concepts: progress(concepts),
    };
    return {
      session: {
        ...carried(),
        lastMoveKind: "open",
        lastLine: OPENING_LINE,
        pending: null,
        questionStreak: 0,
      },
      move,
      signals: [],
      scoreAfter: 0,
      resolved: [],
    };
  }

  // 2. An answer to a wrap-up proposal or to "Keep going or wrap up?".
  if (session.pending === "wrap_proposal" && detectAffirmative(text)) return closeOutcome();

  // 2b. The student answered a check-in or proposal with a question ("Is it log three?", "what do you mean?").
  // A question is neither yes nor no, so the session must not close on it and nothing is scored. The duck
  // cannot answer it ("I'm just a duck"), so it asks again; if they only did not understand, it repeats itself.
  if (
    session.pending !== null &&
    !detectKeepGoing(text) &&
    !detectAffirmative(text) &&
    (detectClarification(text) || detectQuestion(text))
  ) {
    const line = detectClarification(text)
      ? session.lastLine
      : session.pending === "wrap_proposal"
        ? ASK_AGAIN_PROPOSAL_LINE
        : ASK_AGAIN_CHECK_IN_LINE;
    return {
      session: { ...carried(), lastMoveKind: "check_in", lastLine: line },
      move: {
        kind: "check_in",
        level: "L0",
        conceptId: fallbackConceptId,
        line,
        sessionState: session.pending === "wrap_proposal" ? "wrapping_up" : "active",
        concepts: progress(concepts),
      },
      signals: [],
      scoreAfter: focus?.score ?? 0,
      resolved: [],
    };
  }

  // 2c. The student asked what the duck's last question meant. That is not a failed attempt and not a request
  // for a bigger hint, so the ladder stays where it is: the same question, said again (wordMove words it).
  if (
    focus &&
    session.pending === null &&
    detectClarification(text) &&
    session.lastMoveKind !== null &&
    ["question", "rephrase", "open", "offer_skip"].includes(session.lastMoveKind)
  ) {
    const kind: MoveKind = session.lastMoveKind === "question" ? "rephrase" : (session.lastMoveKind as MoveKind);
    return {
      session: { ...carried(), lastMoveKind: kind },
      move: {
        kind,
        level: focus.levelReached,
        conceptId: focus.conceptId,
        line: session.lastLine,
        sessionState: "active",
        concepts: progress(concepts),
      },
      signals: [],
      scoreAfter: focus.score,
      resolved: [],
    };
  }

  // 3. Back from a pause with nothing but "I'm back": repeat the question, score nothing.
  if (
    wasPaused &&
    tokenize(text).length <= ENGINE.shortTurnMaxWords &&
    judgeIsEmpty(input.judge) &&
    !input.answer &&
    detectTextSignals(text, config).length === 0 &&
    !detectMoveOn(text) &&
    !detectHelpRequest(text) &&
    !detectAffirmative(text)
  ) {
    const repeatKind: MoveKind =
      session.lastMoveKind === "offer_skip" || session.lastMoveKind === "check_in"
        ? session.lastMoveKind
        : "rephrase";
    const move: DuckMove = {
      kind: repeatKind,
      level: focus?.levelReached ?? "L0",
      conceptId: fallbackConceptId,
      line: session.lastLine,
      sessionState: session.pending === "wrap_proposal" ? "wrapping_up" : "active",
      concepts: progress(concepts),
    };
    return {
      session: { ...carried(), lastMoveKind: repeatKind },
      move,
      signals: [],
      scoreAfter: focus?.score ?? 0,
      resolved: [],
    };
  }

  // The duck asked a check-in or proposal and the student gave a short reply ("keep going", "no", "sure"):
  // that is not an answer about a concept, so nothing is scored and the duck carries on. A long reply is
  // the student explaining; it is scored as usual and counts as turning the proposal down.
  const repliedToAsk =
    session.pending !== null &&
    (detectKeepGoing(text) ||
      detectAffirmative(text) ||
      (tokenize(text).length <= ENGINE.shortTurnMaxWords && judgeIsEmpty(input.judge)));

  const resolved: ResolvedConcept[] = [];
  const appliedAll = new Set<SignalKind>();
  let focusApplied: SignalKind[] = [];
  let ack: string | undefined;
  let helpRequested = false;
  let skippedNow = false;

  const wantsSkip =
    !repliedToAsk &&
    focus !== undefined &&
    (detectMoveOn(text) ||
      (session.lastMoveKind === "offer_skip" && detectAffirmative(text)));

  if (wantsSkip && focus) {
    focus.state = "skipped";
    focus.skipped = true;
    skippedNow = true;
    ack = ACK_SKIP_LINE;
  } else if (!repliedToAsk) {
    helpRequested = focus !== undefined && detectHelpRequest(text);

    for (const c of concepts) {
      if (!isOpen(c)) continue;
      const isFocus = c === focus;
      const answer = input.answer?.conceptId === c.conceptId ? input.answer : undefined;
      const wrongTrace = answer?.correct === false;

      // Text signals (hedging, fillers, "I don't know") belong to the concept the duck asked about.
      // Judge signals belong to the concept the judge names.
      const signals: SignalKind[] = isFocus
        ? collectSignals(
            { conceptId: c.conceptId, text, judge: input.judge, explanationTurnEnded, wrongTrace },
            config,
          )
        : [
            ...judgeSignals(c.conceptId, text, input.judge, explanationTurnEnded),
            ...(wrongTrace ? (["wrongTrace"] as SignalKind[]) : []),
          ];

      const covered = input.judge.covered.some(
        (item) => item.conceptId === c.conceptId && quoteAppears(text, item.quote),
      );
      const bad =
        wrongTrace ||
        signals.some((s) => s === "misconception" || s === "contradiction" || s === "vague");

      if ((covered || answer?.correct === true) && !bad) {
        const previous = c.score;
        c.score = 0;
        c.state = stateAfterResolve(c.levelReached);
        resolved.push({
          conceptId: c.conceptId,
          state: c.state,
          previous,
          levelReached: c.levelReached,
        });
        if (isFocus) focusApplied = [];
        continue;
      }

      c.score = addSignals(c.score, signals, config);
      if (signals.includes("misconception")) c.state = "misconception";
      for (const s of signals) appliedAll.add(s);
      if (isFocus) {
        focusApplied = signals;
        // Asking for help is not an attempt.
        if (!helpRequested) c.failedAttempts += 1;
      }
    }
  }

  // What to say about the focus concept if it was just resolved: celebrate, or acknowledge.
  let celebrate: { caught: boolean; concept: ConceptRun } | undefined;
  const focusResolved = focus ? resolved.find((r) => r.conceptId === focus.conceptId) : undefined;
  if (focus && focusResolved) {
    const feedback = feedbackFor(
      {
        previous: focusResolved.previous,
        explainedTo: focusResolved.state === "explained_to",
        unaided: focusResolved.levelReached === "L0",
        plantsMisconception: defOf(focus)?.plantsMisconception === true,
        alreadyCelebrated: focus.celebrated,
      },
      config,
    );
    if (feedback.kind === "celebrate") {
      celebrate = { caught: feedback.caught, concept: focus };
      focus.celebrated = true;
    } else {
      ack = feedback.line;
    }
  }

  // Counted after this turn's resolutions and skips. Answering a check-in at the limit already
  // answers the question a proposal would ask, so the duck does not propose straight after it.
  const limit = sessionLimit(finishedConcepts(), activeMs, config);
  let wrapUpProposed = session.wrapUpProposed || (session.pending !== null && limit !== null);

  const helpLine = (c: ConceptRun, level: Level): string | undefined =>
    level === "L0" ? undefined : defOf(c)?.fallbackQuestions[level];

  /** A help move at a level, or an offer to move on when the ladder is used up. */
  const planHelp = (c: ConceptRun, level: Level): PlannedMove => {
    const line = helpLine(c, level);
    const usedUp =
      c.levelReached === "L4" ||
      (c.moves >= config.maxMovesPerConcept && level !== "L4");
    if (usedUp || !line) {
      return {
        kind: "offer_skip",
        level: c.levelReached,
        line: OFFER_SKIP_LINE,
        concept: c,
        help: false,
        sessionState: "active",
      };
    }
    return {
      kind: level === c.levelReached ? "rephrase" : "question",
      level,
      line,
      concept: c,
      help: true,
      sessionState: "active",
    };
  };

  const levelFor = (c: ConceptRun, failedThisTurn: boolean, help: boolean): Level =>
    chooseLevel(
      {
        score: c.score,
        lastLevel: c.levelReached,
        failedAttempts: c.failedAttempts,
        failedThisTurn,
        misconception: c.state === "misconception",
        helpRequested: help,
      },
      config,
    );

  /**
   * Pick the next concept: struggling ones first, then the next unasked one in deck order.
   * With nothing left it proposes wrapping up, or closes if the student already turned that down.
   */
  const planNext = (): PlannedMove => {
    const open = concepts.filter(isOpen);

    const struggling = open
      .filter((c) => c.score >= config.levels.L1)
      .sort((a, b) => b.score - a.score || orderOf.get(a.conceptId)! - orderOf.get(b.conceptId)!);
    if (struggling.length > 0) {
      const c = struggling[0];
      return planHelp(c, levelFor(c, false, false));
    }

    const unasked = open.find((c) => c.moves === 0);
    if (unasked) {
      const def = defOf(unasked);
      const line =
        def?.checkPrompt ?? def?.fallbackQuestions.L1 ?? `Can you tell me about ${def?.name ?? "this"}?`;
      return {
        kind: "question",
        level: "L0",
        line,
        concept: unasked,
        help: false,
        sessionState: "active",
      };
    }

    // Nothing left to ask. The duck never carries on by itself.
    if (wrapUpProposed) {
      return { kind: "wrap_up", level: "L0", line: WRAP_UP_LINE, help: false, sessionState: "wrapping_up", close: true };
    }
    return {
      kind: "check_in",
      level: "L0",
      line: ALL_ASKED_PROPOSAL_LINE,
      help: false,
      sessionState: "wrapping_up",
      pending: "wrap_proposal",
      proposal: true,
    };
  };

  // 4. The ladder picks the next move.
  let planned: PlannedMove;
  let movingOn = false;
  if (focus && isOpen(focus) && !repliedToAsk) {
    const level = levelFor(focus, !helpRequested, helpRequested);
    // L0 means no sign of struggle: say nothing about it and move on.
    if (level === "L0") {
      planned = planNext();
      movingOn = true;
    } else {
      planned = planHelp(focus, level);
    }
  } else {
    planned = planNext();
    movingOn = true;
  }

  const celebrating = celebrate !== undefined;
  // The student has just been answered (acknowledged or celebrated), so this is not another bare question.
  const afterResponse = ack !== undefined || celebrating;
  const skips = concepts.filter((c) => c.skipped).length;

  // 5. Brakes that replace the planned move.
  if (planned.close) {
    // Nothing more to ask and the student already said no to wrapping up: close.
  } else if (skippedNow && skipCheckInDue(skips, session.skipCheckInAsked, config) && !planned.proposal) {
    planned = {
      kind: "check_in",
      level: "L0",
      line: CHECK_IN_LINE,
      conceptId: fallbackConceptId,
      help: false,
      sessionState: "active",
      pending: "check_in",
    };
  } else if (movingOn && !wrapUpProposed && limit !== null && !planned.proposal) {
    planned = {
      kind: "check_in",
      level: "L0",
      line: LIMIT_PROPOSAL_LINE,
      conceptId: fallbackConceptId,
      help: false,
      sessionState: "wrapping_up",
      pending: "wrap_proposal",
      proposal: true,
    };
  } else if (mustOpenUp(session.questionStreak, planned.kind, afterResponse, config)) {
    planned = {
      kind: "open",
      level: focus?.levelReached ?? "L0",
      line: OPEN_PROMPT_LINE,
      conceptId: fallbackConceptId,
      help: false,
      sessionState: "active",
    };
  }

  if (planned.proposal) wrapUpProposed = true;
  const skipCheckInAsked = session.skipCheckInAsked || planned.pending === "check_in";

  if (planned.concept) {
    planned.concept.moves += 1;
    if (planned.help) {
      planned.concept.levelReached = higherLevel(planned.concept.levelReached, planned.level);
    }
  }

  const plannedMove = (withAckLine: string | undefined): DuckMove => ({
    kind: planned.kind,
    level: planned.level,
    conceptId: planned.concept?.conceptId ?? planned.conceptId ?? fallbackConceptId,
    line: withAck(withAckLine, planned.line, config.maxDuckWords),
    sessionState: planned.sessionState,
    concepts: progress(concepts),
  });

  // 6. A celebration is its own move; the planned move follows after the pause.
  let move: DuckMove;
  if (celebrate) {
    const celebrateDef = defOf(celebrate.concept);
    move = {
      kind: "celebrate",
      level: celebrate.concept.levelReached,
      conceptId: celebrate.concept.conceptId,
      line: celebrationLine(celebrateDef?.name ?? "that", celebrate.caught, config.maxDuckWords),
      sessionState: "active",
      concepts: progress(concepts),
      then: plannedMove(undefined),
    };
  } else {
    move = plannedMove(ack);
  }

  const spoken = move.then ?? move;
  const targetId = planned.concept?.conceptId ?? session.focusConceptId;

  return {
    session: {
      ...carried(),
      focusConceptId: targetId,
      lastMoveKind: spoken.kind,
      lastLine: spoken.line,
      questionStreak: nextStreak(session.questionStreak, spoken.kind, afterResponse),
      skipCheckInAsked,
      wrapUpProposed,
      pending: planned.pending ?? null,
      closing: planned.close === true,
      committed:
        input.answer && !session.committed.includes(input.answer.conceptId)
          ? [...session.committed, input.answer.conceptId]
          : session.committed,
    },
    move,
    signals: focus ? focusApplied : [...appliedAll],
    scoreAfter: focus ? focus.score : (planned.concept?.score ?? 0),
    resolved,
  };
}
