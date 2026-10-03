// How the duck session talks to Dev B's API. The real one uses fetch; the mock needs no database.
import type { DuckMove, SessionStart } from "@/lib/duck/types";

export interface TurnPayload {
  text: string;
  startedAt: string;
  endedAt: string;
  silenceBeforeMs: number;
}

export interface DuckTransport {
  startSession(input: { sectionId: string; topic: string; confidence: number }): Promise<SessionStart>;
  sendTurn(sessionId: string, turn: TurnPayload): Promise<DuckMove>;
  sendSilence(sessionId: string, ms: number): Promise<DuckMove>;
  endSession(sessionId: string, reason: string): Promise<DuckMove>;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${url} returned ${res.status}`);
  return data;
}

export const httpTransport: DuckTransport = {
  startSession: (input) => post<SessionStart>("/api/sessions", input),
  sendTurn: (id, turn) => post<DuckMove>(`/api/sessions/${id}/turn`, turn),
  sendSilence: (id, ms) => post<DuckMove>(`/api/sessions/${id}/silence`, { ms }),
  endSession: (id, reason) => post<DuckMove>(`/api/sessions/${id}/end`, { reason }),
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function move(kind: DuckMove["kind"], line: string, sessionState: DuckMove["sessionState"] = "active"): DuckMove {
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
