// How the duck session talks to Dev B's API. The real one uses fetch; the mock needs no database.
import type { DuckMove, SessionStart } from "@/lib/duck/types";

/** A move as the server sends it. A celebrate move can carry `then`, the move to make after it. */
export type SpokenMove = DuckMove;

export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export interface TurnPayload {
  text: string;
  startedAt: string;
  endedAt: string;
  silenceBeforeMs: number;
}

export interface DuckTransport {
  startSession(input: { sectionId: string; topic: string; confidence: number }): Promise<SessionStart & { move: SpokenMove }>;
  sendTurn(sessionId: string, turn: TurnPayload): Promise<SpokenMove>;
  /** Resolves to null when the server has nothing to say (HTTP 409), which is not an error. */
  sendSilence(sessionId: string, ms: number): Promise<SpokenMove | null>;
  endSession(sessionId: string, reason: string): Promise<SpokenMove>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new HttpError(data.error ?? `${url} returned ${res.status}`, res.status);
  return data;
}

export const httpTransport: DuckTransport = {
  startSession: (input) => post<SessionStart & { move: SpokenMove }>("/api/sessions", input),
  sendTurn: (id, turn) => post<SpokenMove>(`/api/sessions/${id}/turn`, turn),
  sendSilence: (id, ms) =>
    post<SpokenMove>(`/api/sessions/${id}/silence`, { ms }).catch((error) => {
      if (error instanceof HttpError && error.status === 409) return null;
      throw error;
    }),
  endSession: (id, reason) => post<SpokenMove>(`/api/sessions/${id}/end`, { reason }),
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function move(kind: DuckMove["kind"], line: string, sessionState: DuckMove["sessionState"] = "active"): SpokenMove {
  return { kind, level: "L1", conceptId: "c_12", line, sessionState, concepts: [] };
}

/** Fake server for testing the voice loop without a database. `turnDelayMs` lets you provoke the filler line. */
export function mockTransport(options: { turnDelayMs?: number } = {}): DuckTransport {
  let turns = 0;
  return {
    async startSession(input) {
      return {
        sessionId: "mock",
        topic: input.topic,
        confidence: input.confidence,
        move: move("open", "Ooh! Can you explain it to me? I'm just a duck."),
      };
    },
    async sendTurn() {
      await wait(options.turnDelayMs ?? 0);
      turns++;
      if (turns === 3) {
        return {
          ...move("celebrate", "Ooh, nice. You found where it stops."),
          then: move("question", "Next one: how many checks for a million items?"),
        };
      }
      if (turns >= 4) return move("wrap_up", "That's about all I can take. Want to wrap up?");
      return turns % 2 === 1
        ? move("question", "So I could use it on my pebbles? They're all mixed up.")
        : move("question", "Slide 4 says something about order. What does it say?");
    },
    async sendSilence(_id, ms) {
      if (ms >= 45_000) return move("pause", "I'll be here when you're ready.", "paused");
      if (ms >= 20_000) return move("offer_skip", "Want to skip this one?");
      return move("rephrase", "So I could use it on my pebbles? They're all mixed up.");
    },
    async endSession() {
      return move("wrap_up", "You found where it stops. Revisit the update step.", "wrapping_up");
    },
  };
}
