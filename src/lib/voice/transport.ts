// How the duck session talks to Dev B's API. The real one uses fetch; the mock needs no database.
import { VOICE } from "@/lib/duck/config";
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
  startSession(input: {
    sectionId: string;
    topic: string;
    confidence: number;
    documentId?: string;
  }): Promise<SessionStart & { move: SpokenMove }>;
  sendTurn(sessionId: string, turn: TurnPayload): Promise<SpokenMove>;
  /** Resolves to null when the server has nothing to say (HTTP 409), which is not an error. */
  sendSilence(sessionId: string, ms: number): Promise<SpokenMove | null>;
  endSession(sessionId: string, reason: string): Promise<SpokenMove>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // A hung server must not leave the duck "thinking" forever.
      signal: AbortSignal.timeout(VOICE.requestTimeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new HttpError(timedOut ? "The server took too long to answer" : "Could not reach the server", timedOut ? 408 : 0);
  }
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

/** Fake server for testing the voice loop without a database. `turnDelayMs` provokes the filler line; `failTurns` provokes recovery. */
export function mockTransport(options: { turnDelayMs?: number; failTurns?: number } = {}): DuckTransport {
  let turns = 0;
  let failed = 0;
  return {
    async startSession(input) {
      return {
        sessionId: "mock",
        topic: input.topic,
        confidence: input.confidence,
        move: move("open", "I don't really get binary search yet. How does it work?"),
      };
    },
    async sendTurn() {
      await wait(options.turnDelayMs ?? 0);
      // `failTurns` makes the first N turn requests fail (Infinity = always), to test recovery.
      if (failed < (options.failTurns ?? 0)) {
        failed++;
        throw new HttpError("Mock server failure", 500);
      }
      turns++;
      if (turns === 3) {
        return {
          ...move("celebrate", "Mm. You just got when it stops."),
          then: move("question", "Next one: how many checks for a million items?"),
        };
      }
      if (turns >= 4) return move("wrap_up", "That's about all I can take. Want to wrap up?");
      return turns % 2 === 1
        ? move("question", "So I could use it on my pebbles? They're all mixed up.")
        : move("question", "Hmm, does the order of the things matter?");
    },
    async sendSilence(_id, ms) {
      if (ms >= 45_000) return move("pause", "I'll be here when you're ready.", "paused");
      if (ms >= 20_000) return move("offer_skip", "Want to leave this one for later?");
      return move("wait", "Take your time.");
    },
    async endSession() {
      return move("wrap_up", "Your best bit was when it stops. Next time we can try the update step.", "wrapping_up");
    },
  };
}
