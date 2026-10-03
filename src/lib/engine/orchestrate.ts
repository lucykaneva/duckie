import { DUCK, ENGINE } from "../duck/config";
import type { DuckConfig } from "../duck/config";
import type { ConceptForJudge, DuckMove, JudgeResult, Profile, TurnLogRow } from "../duck/types";
import type { JudgeInput } from "../prompts/judgeTurn";
import { isWorded } from "../prompts/wordMove";
import type { WordMoveInput, WordMoveResult } from "../prompts/wordMove";
import type { AiFailure } from "../prompts/xai";
import { committedAnswer } from "./commit";
import { guardMove } from "./guard";
import type { StoredAnswer } from "./guard";
import { processSilence } from "./silence";
import type { SilenceStep } from "./silence";
import {
  detectAffirmative,
  detectClarification,
  detectKeepGoing,
  detectMoveOn,
  detectAskingQuestion,
  detectQuestion,
  detectWrapUpRequest,
  plantedAgreementQuote,
  tokenize,
} from "./signals";
import { emptyJudgeResult } from "./stub-judge";
import { hasNotStartedTeaching, processTurn, taughtThisTurn } from "./turn";
import type { ConceptDef, SessionRun, TurnOutcome } from "./turn";

// B11: one student turn, start to finish, without touching the database.
//
//   code reads the signals it can  ->  judgeTurn (Grok) reads the structure  ->  the engine decides
//   ->  wordMove (Grok) phrases the line  ->  the leak check blocks any line that says an answer
//
// Code decides everything that matters. Each Grok call has a time limit (set where the call lives:
// PROMPTS in config.ts). If the judge fails or is slow, the turn is evaluated with code-only signals; if
// wordMove fails, the precomputed line is spoken. The AI is never needed for the duck to answer.

export interface OrchestrateDeps {
  /** Dev A's judgeTurn. Throws when Grok is unavailable, slow or returns something unusable. */
  judge: (input: JudgeInput) => Promise<JudgeResult>;
  /** Dev A's wordMoveDetailed. Always resolves to a speakable line. */
  word: (input: WordMoveInput) => Promise<WordMoveResult>;
  /** Dev A's summarizeProfile (A11). Always returns a usable profile. */
  summarize?: (input: {
    turns: TurnLogRow[];
    previous?: Profile;
    sessions?: { confidence: number; understanding: number }[];
    userId?: string;
  }) => Promise<Profile>;
  /** For tests: a clock that can be moved. */
  now?: () => number;
}

/** Why the AI was or was not used, for the decision log. Never contains a stored answer. */
export interface TurnMeta {
  /** ok: judged. skipped: nothing to judge. Otherwise why the turn fell back to code-only signals. */
  judge: "ok" | "skipped" | AiFailure | "error";
  judgeMs: number | null;
  /** What the code runner decided about a committed trace or prediction answer. */
  answer: "correct" | "wrong" | null;
  /** One entry per line wordMove was asked about. */
  words: { source: WordMoveResult["source"]; attempts: number; problem?: string; failure?: AiFailure }[];
  /** Concepts whose answer a line was about to say and was replaced. */
  leakBlocked: string[];
}

export interface TurnArgs {
  defs: ConceptDef[];
  run: SessionRun;
  /** Stored answers of the section's trace and prediction concepts. Server only. */
  answers: StoredAnswer[];
  text: string;
  /** When the turn finished, epoch ms. */
  nowMs: number;
  /** The student's tone hint from their profile (B13). Wording only. */
  toneHint?: string;
}

export interface Orchestrated {
  /** The engine's outcome with the final, leak-checked lines. */
  outcome: TurnOutcome;
  meta: TurnMeta;
}

const isOpen = (c: SessionRun["concepts"][number]): boolean =>
  !c.skipped && (c.state === "not_yet" || c.state === "misconception");

/**
 * Is there anything for the judge to read? Skips the Grok call (and its delay) for turns the engine
 * handles without scoring: closing, asking to stop, a short reply to a check-in or proposal, a plain
 * "yes" to a skip offer, a request to skip, and "I'm back" after a pause.
 */
export function needsJudge(run: SessionRun, text: string): boolean {
  if (!text.trim() || run.closing) return false;
  if (detectWrapUpRequest(text) || detectMoveOn(text)) return false;
  const short = tokenize(text).length <= ENGINE.shortTurnMaxWords;
  if (run.pending !== null && (short || detectKeepGoing(text) || detectAffirmative(text))) return false;
  if (run.lastMoveKind === "offer_skip" && detectAffirmative(text)) return false;
  // "What do you mean?" and a question in reply to a check-in: the engine repeats itself, nothing to judge.
  if (detectClarification(text)) return false;
  if (run.pending !== null && detectQuestion(text)) return false;
  // A question means "help me": the engine gives a hint and scores nothing, so there is nothing to judge.
  if (detectAskingQuestion(text)) return false;
  if (run.pausedAtMs !== null && short) return false;
  return true;
}

/**
 * "Missed" means the student's explanation left something out. Only an idea that can be explained counts.
 * A trace or prediction is something the duck tests later. A planted claim is a probe the duck brings
 * up itself. A check question that asks how many, or already contains a number, is a later quiz.
 * Leaving those out is not a miss.
 */
const LATER_QUIZ = /\d|\b(?:how many|million|thousand|billion)\b/i;

function onlyExplainable(result: JudgeResult, defs: ConceptDef[]): JudgeResult {
  const explainable = new Set(
    defs
      .filter((d) => d.kind === "explain" && !d.plantsMisconception && !LATER_QUIZ.test(d.checkPrompt ?? ""))
      .map((d) => d.id),
  );
  return { ...result, missed: result.missed.filter((m) => explainable.has(m.conceptId)) };
}

/**
 * The spec's turn 5: the duck planted a wrong claim and the student said "I think that's fine?".
 * Grok often misses that, because the student never restated the claim. Code reads the agreement
 * and attaches a verbatim quote so the usual quote rule still holds.
 */
/** After Grok reads the turn: miss leftover explainable ideas only if they actually taught. */
function finishJudge(result: JudgeResult, args: TurnArgs): JudgeResult {
  const taught = taughtThisTurn(result, committedAnswer(args.text, args.run, args.defs, args.answers));
  if (!hasNotStartedTeaching(args.run) || !taught) {
    return { ...onlyExplainable(result, args.defs), missed: [] };
  }
  const evidenced = new Set(
    [
      ...result.covered,
      ...result.misconceptions,
      ...result.vague,
      ...result.contradictions,
    ].map((item) => item.conceptId),
  );
  const missed = args.run.concepts
    .filter((c) => isOpen(c) && !evidenced.has(c.conceptId))
    .map((c) => ({ conceptId: c.conceptId }));
  return onlyExplainable({ ...result, missed }, args.defs);
}

function withPlantedAgreement(result: JudgeResult, args: TurnArgs): JudgeResult {
  const focusId = args.run.focusConceptId;
  const def = focusId ? args.defs.find((d) => d.id === focusId) : undefined;
  if (!def?.plantsMisconception) return result;
  if (result.misconceptions.some((m) => m.conceptId === def.id)) return result;
  if (result.covered.some((c) => c.conceptId === def.id)) return result;
  const quote = plantedAgreementQuote(args.text);
  if (!quote) return result;
  return { ...result, misconceptions: [...result.misconceptions, { conceptId: def.id, quote }] };
}

/**
 * The judge is unavailable. The engine only starts quizzing once something shows the student has begun
 * teaching, and without Grok nothing would, so the duck would invite forever. A turn longer than a
 * short reply is taken as "they started explaining" and attached to the first open idea as a vague
 * item, quoting the student's own opening words. The duck then works through its precomputed questions.
 */
function codeOnlyJudge(args: TurnArgs): JudgeResult {
  const base = emptyJudgeResult();
  if (!hasNotStartedTeaching(args.run)) return base;
  const words = args.text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= ENGINE.shortTurnMaxWords) return base;
  const first = args.run.concepts.find(isOpen);
  if (!first) return base;
  return { ...base, vague: [{ conceptId: first.conceptId, quote: words.slice(0, 4).join(" ") }] };
}

async function runJudge(
  args: TurnArgs,
  deps: OrchestrateDeps,
): Promise<{ result: JudgeResult; judge: TurnMeta["judge"]; judgeMs: number | null }> {
  if (!needsJudge(args.run, args.text)) {
    return { result: withPlantedAgreement(emptyJudgeResult(), args), judge: "skipped", judgeMs: null };
  }

  const concepts: ConceptForJudge[] = args.run.concepts
    .filter(isOpen)
    .flatMap((c) => {
      const def = args.defs.find((d) => d.id === c.conceptId);
      return def ? [{ id: def.id, name: def.name, misconceptions: def.misconceptions }] : [];
    });
  if (concepts.length === 0) {
    return { result: withPlantedAgreement(emptyJudgeResult(), args), judge: "skipped", judgeMs: null };
  }

  const now = deps.now ?? Date.now;
  const started = now();
  try {
    const focusDef = args.run.focusConceptId
      ? args.defs.find((d) => d.id === args.run.focusConceptId)
      : undefined;
    const result = await deps.judge({
      text: args.text,
      concepts,
      // Missed is applied after we know they taught, not on a hello.
      explanationTurnEnded: false,
      ...(focusDef
        ? {
            duckAsked: {
              conceptId: focusDef.id,
              line: args.run.lastLine,
              plantsMisconception: focusDef.plantsMisconception === true,
            },
          }
        : {}),
    });
    return {
      result: finishJudge(withPlantedAgreement(result, args), args),
      judge: "ok",
      judgeMs: now() - started,
    };
  } catch (error) {
    const reason = (error as { reason?: AiFailure } | null)?.reason;
    return {
      result: withPlantedAgreement(codeOnlyJudge(args), args),
      judge: reason ?? "error",
      judgeMs: now() - started,
    };
  }
}

/**
 * Ask wordMove to phrase every line of the move that is meant to be reworded (help questions,
 * rephrases, celebrations), then run the leak check over what came back. The prompt never contains a
 * stored answer; the check is the second line of defence.
 */
function conversationSituation(
  defs: ConceptDef[],
  run: SessionRun,
  judge: JudgeResult,
): string {
  const nameOf = (id: string) => defs.find((d) => d.id === id)?.name ?? id;
  const topic = defs[0]?.topic ?? "this topic";
  const covered = [...new Set(judge.covered.map((c) => nameOf(c.conceptId)))];
  const missed = [...new Set(judge.missed.map((c) => nameOf(c.conceptId)))];
  const open = run.concepts.filter(isOpen).map((c) => nameOf(c.conceptId));
  return [
    `You are a plush duck. The student is teaching you ${topic} out loud. Continue this conversation. Reply to what they just said.`,
    covered.length ? `They just made sense of: ${covered.join(", ")}.` : "They have not explained a concept yet.",
    missed.length ? `They have not yet explained: ${missed.join(", ")}.` : "",
    open.length ? `Ideas still open: ${open.join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function wordAndGuard(
  move: DuckMove,
  context: {
    defs: ConceptDef[];
    answers: StoredAnswer[];
    committed: string[];
    studentWords: string;
    toneHint?: string;
    run: SessionRun;
    judge: JudgeResult;
  },
  deps: OrchestrateDeps,
): Promise<{ move: DuckMove; words: TurnMeta["words"]; leakBlocked: string[] }> {
  const words: TurnMeta["words"] = [];

  const wordLine = async (m: DuckMove): Promise<string> => {
    if (!isWorded(m)) return m.line;
    const def = context.defs.find((d) => d.id === m.conceptId);
    const result = await deps.word({
      kind: m.kind,
      level: m.level,
      conceptName: def?.name ?? "this idea",
      topic: context.defs[0]?.topic,
      slide: def && def.slide > 0 ? def.slide : undefined,
      studentWords: context.studentWords,
      toneHint: context.toneHint,
      fallbackLine: m.line,
      situation: conversationSituation(context.defs, context.run, context.judge),
      lastDuckLine: context.run.lastLine,
    });
    words.push({
      source: result.source,
      attempts: result.attempts,
      ...(result.problem ? { problem: result.problem } : {}),
      ...(result.failure ? { failure: result.failure } : {}),
    });
    return result.line;
  };

  // A celebration and its follow-up question are independent lines: word them side by side.
  const reword = async (m: DuckMove): Promise<DuckMove> => {
    const [line, then] = await Promise.all([wordLine(m), m.then ? reword(m.then) : undefined]);
    return { ...m, line, ...(then ? { then } : {}) };
  };
  const worded = await reword(move);

  const guarded = guardMove(worded, context.defs, context.answers, context.committed);
  return { move: guarded.move, words, leakBlocked: guarded.blocked };
}

/** One finished student turn: judge, decide, word, guard. Never throws because of the AI. */
export async function orchestrateTurn(
  args: TurnArgs,
  deps: OrchestrateDeps,
  config: DuckConfig = DUCK,
): Promise<Orchestrated> {
  const answer = committedAnswer(args.text, args.run, args.defs, args.answers);
  const judged = await runJudge(args, deps);

  const raw = processTurn(
    args.defs,
    args.run,
    { text: args.text, judge: judged.result, answer, nowMs: args.nowMs },
    config,
  );

  const final = await wordAndGuard(
    raw.move,
    {
      defs: args.defs,
      answers: args.answers,
      committed: raw.session.committed,
      studentWords: args.text,
      toneHint: args.toneHint,
      run: args.run,
      judge: judged.result,
    },
    deps,
  );
  const spoken = final.move.then ?? final.move;

  return {
    outcome: { ...raw, move: final.move, session: { ...raw.session, lastLine: spoken.line } },
    meta: {
      judge: judged.judge,
      judgeMs: judged.judgeMs,
      answer: answer ? (answer.correct ? "correct" : "wrong") : null,
      words: final.words,
      leakBlocked: final.leakBlocked,
    },
  };
}

export interface SilenceArgs {
  defs: ConceptDef[];
  run: SessionRun;
  answers: StoredAnswer[];
  step: SilenceStep;
  nowMs: number;
  toneHint?: string;
}

export interface OrchestratedSilence {
  session: SessionRun;
  move: DuckMove;
  signals: TurnOutcome["signals"];
  scoreAfter: number;
  meta: TurnMeta;
}

/**
 * A silence timer. The 8 s rephrase is reworded like any help question (the student said nothing, so
 * there are no words to reuse); the offer, pause and check-in repeats are fixed lines. Returns null when
 * there is nothing to do.
 */
export async function orchestrateSilence(
  args: SilenceArgs,
  deps: OrchestrateDeps,
  config: DuckConfig = DUCK,
): Promise<OrchestratedSilence | null> {
  const raw = processSilence(args.run, args.step, args.nowMs, config);
  if (!raw) return null;

  const final = await wordAndGuard(
    raw.move,
    {
      defs: args.defs,
      answers: args.answers,
      committed: raw.session.committed,
      studentWords: "",
      toneHint: args.toneHint,
      run: args.run,
      judge: emptyJudgeResult(),
    },
    deps,
  );
  return {
    session: raw.session,
    move: final.move,
    signals: raw.signals,
    scoreAfter: raw.scoreAfter,
    meta: { judge: "skipped", judgeMs: null, answer: null, words: final.words, leakBlocked: final.leakBlocked },
  };
}
