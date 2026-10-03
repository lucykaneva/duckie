// A10, voice side: what the duck does when the server fails. The real microphone and Grok Voice are
// replaced with a fake; the real DuckSession runs against a transport that can fail.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VOICE } from "../src/lib/duck/config";

const voice = vi.hoisted(() => ({
  spoken: [] as string[],
  handler: null as null | ((event: unknown) => void),
  stopped: false,
}));

vi.mock("../src/lib/voice/session", () => ({
  DuckVoice: class {
    constructor(handler: (event: unknown) => void) {
      voice.handler = handler;
    }
    async start() {
      voice.handler?.({ type: "status", status: "listening" });
    }
    speak(line: string) {
      voice.spoken.push(line);
    }
    hush() {}
    stop() {
      voice.stopped = true;
    }
  },
}));

import {
  DuckSession,
  GIVE_UP_LINE,
  RETRY_LINE,
  type DuckSessionEvent,
} from "../src/lib/voice/duckSession";
import { HttpError, mockTransport, type DuckTransport } from "../src/lib/voice/transport";
import { wordCount } from "../src/lib/engine/wording";

const say = (text: string) =>
  voice.handler?.({
    type: "turn",
    turn: { text, startedAt: new Date(0).toISOString(), endedAt: new Date(1000).toISOString() },
  });
const duckFinishedSpeaking = () => voice.handler?.({ type: "duck_idle" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function startWith(transport: DuckTransport) {
  const events: DuckSessionEvent[] = [];
  const session = new DuckSession(
    { sectionId: "sec_1", topic: "Binary search", confidence: 4, transport },
    (event) => events.push(event),
  );
  await session.start();
  duckFinishedSpeaking(); // the opening line ends
  return { session, events };
}

const states = (events: DuckSessionEvent[]) =>
  events.flatMap((e) => (e.type === "state" ? [e.state] : []));

beforeEach(() => {
  voice.spoken.length = 0;
  voice.handler = null;
  voice.stopped = false;
});

describe("the recovery lines", () => {
  it("obey the duck's own rules", () => {
    for (const line of [RETRY_LINE, GIVE_UP_LINE]) {
      expect(wordCount(line)).toBeLessThanOrEqual(20);
      expect((line.match(/\?/g) ?? []).length).toBeLessThanOrEqual(1);
    }
  });
});

describe("when /turn fails", () => {
  it("says it lost that, keeps listening, and carries on once the server is back", async () => {
    const { events } = await startWith(mockTransport({ failTurns: 1 }));
    voice.spoken.length = 0;

    say("You look at the middle and keep halving.");
    await tick();
    expect(voice.spoken).toEqual([RETRY_LINE]); // never silent

    const recovering = events.find((e) => e.type === "recovering");
    expect(recovering).toMatchObject({ failures: 1, spoke: true });
    expect(events.some((e) => e.type === "error")).toBe(false); // not an error banner: the session goes on
    expect(events.some((e) => e.type === "move" && e.source === "recovery")).toBe(true);
    expect(states(events).at(-1)).toBe("speaking");

    duckFinishedSpeaking();
    expect(states(events).at(-1)).toBe("listening");
    expect(events.at(-1)).toMatchObject({ type: "silence_armed" }); // silence timers still run

    // The student says it again (in other words, so it is not mistaken for an echo); the server answers.
    say("So you look in the middle and then halve the list.");
    await tick();
    expect(voice.spoken.at(-1)).toBe("So I could use it on my pebbles? They're all mixed up.");
  });

  it("counts failures in a row, and a success resets the count", async () => {
    let calls = 0;
    const flaky: DuckTransport = {
      ...mockTransport(),
      async sendTurn(id, turn) {
        calls++;
        if (calls === 1 || calls === 2 || calls === 4) throw new HttpError("boom", 500);
        return mockTransport().sendTurn(id, turn);
      },
    };
    const { session, events } = await startWith(flaky);

    for (let i = 0; i < 4; i++) {
      say(`turn number ${i}`);
      await tick();
      duckFinishedSpeaking();
    }
    const counts = events.flatMap((e) => (e.type === "recovering" ? [e.failures] : []));
    expect(counts).toEqual([1, 2, 1]); // fail, fail, (success resets), fail
    expect(voice.stopped).toBe(false);
    session.stop();
  });

  it("gives up politely after several failures in a row, and tries to close the session", async () => {
    const ended: string[] = [];
    const transport: DuckTransport = {
      ...mockTransport({ failTurns: Infinity }),
      endSession: async (_id, reason) => {
        ended.push(reason);
        throw new HttpError("down too", 500);
      },
    };
    const { events } = await startWith(transport);
    voice.spoken.length = 0;

    for (let i = 0; i < VOICE.maxFailedTurnsInARow; i++) {
      say(`try number ${i}`);
      await tick();
      if (i < VOICE.maxFailedTurnsInARow - 1) duckFinishedSpeaking();
    }
    expect(voice.spoken).toEqual([RETRY_LINE, RETRY_LINE, GIVE_UP_LINE]);
    expect(events.filter((e) => e.type === "error")).toHaveLength(1); // only the final one reaches the banner
    expect(ended).toEqual(["server_unreachable"]);

    expect(voice.stopped).toBe(false); // the goodbye is still playing
    duckFinishedSpeaking();
    expect(voice.stopped).toBe(true);
    expect(states(events).at(-1)).toBe("ended");
  });

  it("does not interrupt a student who has already started talking again", async () => {
    const releases: Array<() => void> = [];
    let calls = 0;
    const slowThenFine: DuckTransport = {
      ...mockTransport(),
      sendTurn: (id, turn) => {
        calls++;
        if (calls > 1) return mockTransport().sendTurn(id, turn);
        return new Promise((_resolve, reject) => {
          releases.push(() => reject(new HttpError("late failure", 500)));
        });
      },
    };
    const { events } = await startWith(slowThenFine);
    voice.spoken.length = 0;

    say("first thought, which the server is slow to answer");
    await tick();
    say("a different second thought, said while the first was in flight");
    await tick();
    releases[0](); // now the first request fails, long after the student moved on
    await tick();

    expect(voice.spoken).not.toContain(RETRY_LINE);
    expect(voice.spoken).toHaveLength(1); // only the reply to the second thought
    expect(events.some((e) => e.type === "recovering" && !e.spoke)).toBe(true);
  });
});

describe("when a silence prompt fails", () => {
  it("says nothing and does not raise an error", async () => {
    vi.useFakeTimers();
    try {
      const transport: DuckTransport = {
        ...mockTransport(),
        sendSilence: async () => {
          throw new HttpError("down", 500);
        },
      };
      const { events, session } = await startWith(transport);
      voice.spoken.length = 0;
      await vi.advanceTimersByTimeAsync(9_000); // the 8 s timer fires
      expect(voice.spoken).toEqual([]);
      expect(events.some((e) => e.type === "error")).toBe(false);
      expect(events.some((e) => e.type === "recovering" && !e.spoke)).toBe(true);
      session.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
