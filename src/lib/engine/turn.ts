import { DUCK } from "../duck/config";
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
import { chooseLevel, higherLevel, stateAfterResolve } from "./ladder";
import { addSignals, collectSignals, judgeSignals, quoteAppears } from "./score";
import {
  detectAffirmative,
  detectHelpRequest,
  detectMoveOn,
} from "./signals";
import type { SignalKind } from "./signals";
import {
  ACK_AFTER_EXPLAIN_LINE,
  ACK_LINE,
  ACK_SKIP_LINE,
  OFFER_SKIP_LINE,
  OPENING_LINE,
  WRAP_UP_LINE,
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

export interface SessionRun {
  /** In deck order (slide, then id). */
  concepts: ConceptRun[];
  /** The concept the duck last asked about. */
  focusConceptId: string | null;
  lastMoveKind: MoveKind | null;
  /** Finished student turns so far. */
  turnCount: number;
}

export interface TurnInput {
  text: string;
  /** Dev A's judgeTurn result (an empty result until it is wired in). */
  judge: JudgeResult;
  /** The code runner's verdict on a committed trace or prediction (B10). */
  answer?: { conceptId: string; correct: boolean };
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
export function freshSession(defs: ConceptDef[]): SessionRun {
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
  };
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
  /** The concept this move is about; undefined for the wrap-up. */
  concept?: ConceptRun;
  /** Counts as a help level on the concept (L1 to L4). */
  help: boolean;
  sessionState: SessionState;
}

/**
 * Process one finished student turn: update every open concept's score, resolve
 * or skip concepts, then make exactly one move. Pure; the caller loads and saves state.
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
  // "Missed" counts only when the student's explanation turn has ended: the first finished turn.
  const explanationTurnEnded = session.turnCount === 0;

  const focusRun = concepts.find((c) => c.conceptId === session.focusConceptId);
  const focus = focusRun && isOpen(focusRun) ? focusRun : undefined;

  const resolved: ResolvedConcept[] = [];
  const appliedAll = new Set<SignalKind>();
  let focusApplied: SignalKind[] = [];
  let ack: string | undefined;
  let helpRequested = false;

  const wantsSkip =
    focus !== undefined &&
    (detectMoveOn(text) ||
      (session.lastMoveKind === "offer_skip" && detectAffirmative(text)));

  if (wantsSkip && focus) {
    focus.state = "skipped";
    focus.skipped = true;
    ack = ACK_SKIP_LINE;
  } else {
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
        if (isFocus) {
          ack = c.state === "explained_to" ? ACK_AFTER_EXPLAIN_LINE : ACK_LINE;
          focusApplied = [];
        }
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

  const defOf = (c: ConceptRun): ConceptDef | undefined => defById.get(c.conceptId);

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

  /** Pick the next concept: struggling ones first, then the next unasked one in deck order. */
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

    return { kind: "wrap_up", level: "L0", line: WRAP_UP_LINE, help: false, sessionState: "wrapping_up" };
  };

  let planned: PlannedMove;
  if (focus && isOpen(focus)) {
    const level = levelFor(focus, !helpRequested, helpRequested);
    // L0 means no sign of struggle: say nothing about it and move on.
    planned = level === "L0" ? planNext() : planHelp(focus, level);
  } else {
    planned = planNext();
  }

  if (planned.concept) {
    planned.concept.moves += 1;
    if (planned.help) {
      planned.concept.levelReached = higherLevel(planned.concept.levelReached, planned.level);
    }
  }

  const targetId = planned.concept?.conceptId ?? session.focusConceptId ?? concepts[0]?.conceptId ?? "";
  const move: DuckMove = {
    kind: planned.kind,
    level: planned.level,
    conceptId: targetId,
    line: withAck(ack, planned.line, config.maxDuckWords),
    sessionState: planned.sessionState,
    concepts: progress(concepts),
  };

  return {
    session: {
      concepts,
      focusConceptId: planned.concept?.conceptId ?? session.focusConceptId,
      lastMoveKind: move.kind,
      turnCount: session.turnCount + 1,
    },
    move,
    signals: focus ? focusApplied : [...appliedAll],
    scoreAfter: focus ? focus.score : (planned.concept?.score ?? 0),
    resolved,
  };
}
