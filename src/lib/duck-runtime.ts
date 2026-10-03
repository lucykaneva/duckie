/**
 * Holds the live DuckSession across the start → session navigation,
 * and fans its events out so the session page (and the ?dev=1 panel)
 * read the same state.
 *
 * DuckSession itself has no public getter for state or transcript, and
 * no resume() method. Pause ends when the student talks. This module
 * keeps the last snapshot so the session page can catch up after route
 * change, and lets the dev panel write into that same snapshot.
 */

import {
  DuckSession,
  type DuckSessionEvent,
  type DuckSessionOptions,
  type DuckState,
} from "@/lib/voice/duckSession";

export type { DuckState };

export type TranscriptLine = {
  speaker: "student" | "duck";
  text: string;
  at: number;
};

type Listener = (event: DuckSessionEvent) => void;

const listeners = new Set<Listener>();

let current: DuckSession | null = null;
let lastState: DuckState = "idle";
const lines: TranscriptLine[] = [];

function emit(event: DuckSessionEvent) {
  if (event.type === "state") lastState = event.state;
  if (event.type === "student_turn") {
    lines.push({ speaker: "student", text: event.turn.text, at: Date.now() });
  }
  if (event.type === "move") {
    lines.push({ speaker: "duck", text: event.move.line, at: Date.now() });
  }
  if (event.type === "filler") {
    lines.push({ speaker: "duck", text: "Hmm, let me think.", at: Date.now() });
  }
  for (const listener of [...listeners]) listener(event);
}

export function onDuckRuntimeEvent(callback: Listener): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function getDuckSession(): DuckSession | null {
  return current;
}

export function getDuckSnapshot(): { state: DuckState; lines: TranscriptLine[] } {
  return { state: lastState, lines: [...lines] };
}

export function createDuckSession(options: DuckSessionOptions): DuckSession {
  current?.stop();
  lastState = "idle";
  lines.length = 0;
  current = new DuckSession(options, emit);
  return current;
}

export function releaseDuckSession() {
  current = null;
}

/** Dev panel and Resume: write the same state the session page already reads. */
export function debugSetDuckState(state: DuckState) {
  emit({ type: "state", state });
}

export function debugAddTranscript(line: TranscriptLine) {
  if (line.speaker === "student") {
    emit({
      type: "student_turn",
      turn: {
        text: line.text,
        startedAt: new Date(line.at).toISOString(),
        endedAt: new Date(line.at).toISOString(),
        silenceBeforeMs: 0,
      },
    });
  } else {
    emit({
      type: "move",
      source: "turn",
      move: {
        kind: "question",
        level: "L1",
        conceptId: "c_12",
        line: line.text,
        sessionState: "active",
        concepts: [],
      },
    });
  }
}
