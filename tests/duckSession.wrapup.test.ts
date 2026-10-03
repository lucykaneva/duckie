// A12, voice side: the proposal to wrap up and the wrap-up from /end are spoken, in order, and the session
// only finishes after the closing line has been heard. The real DuckSession runs against a fake voice.
import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { DuckSession, type DuckSessionEvent } from "../src/lib/voice/duckSession";
import { HttpError, mockTransport, type DuckTransport } from "../src/lib/voice/transport";

type Move = Awaited<ReturnType<DuckTransport["sendTurn"]>>;

const move = (kind: Move["kind"], line: string, sessionState: Move["sessionState"] = "wrapping_up"): Move => ({
  kind,
  level: "L0",
  conceptId: "c_12",
  line,
  sessionState,
  concepts: [],
});

const say = (text: string) =>
  voice.handler?.({
    type: "turn",
    turn: { text, startedAt: new Date(0).toISOString(), endedAt: new Date(1000).toISOString() },
  });
const duckFinishedSpeaking = () => voice.handler?.({ type: "duck_idle" });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const SUMMARY = "You explained halving well. Revisit the update step.";

async function startWith(transport: DuckTransport) {
  const events: DuckSessionEvent[] = [];
  const session = new DuckSession(
    { sectionId: "sec_1", topic: "Binary search", confidence: 4, transport },
    (event) => events.push(event),
  );
  await session.start();
  duckFinishedSpeaking();
  voice.spoken.length = 0;
  return { session, events };
}

const states = (events: DuckSessionEvent[]) => events.flatMap((e) => (e.type === "state" ? [e.state] : []));

beforeEach(() => {
  voice.spoken.length = 0;
  voice.handler = null;
  voice.stopped = false;
});

describe("the proposal to wrap up", () => {
  it("is spoken like any question, and the silence timers run while it waits for a yes or no", async () => {
    const proposal = "That's everything I wanted to ask. Ready to wrap up?";
    const { events } = await startWith({
      ...mockTransport(),
      sendTurn: async () => ({ ...move("check_in", proposal), concepts: [] }),
    });
    say("It stops when lo passes hi.");
    await tick();
    expect(voice.spoken).toEqual([proposal]);
    duckFinishedSpeaking();
    expect(events.at(-1)).toMatchObject({ type: "silence_armed" });
    expect(voice.stopped).toBe(false); // nothing ends until the student says yes
  });
});

describe("when the student agrees to wrap up", () => {
  it("speaks the closing line from /turn, then the summary from /end, then finishes", async () => {
    const ended: string[] = [];
    const { events } = await startWith({
      ...mockTransport(),
      sendTurn: async () => move("wrap_up", "Okay, let's wrap up."),
      endSession: async (_id, reason) => {
        ended.push(reason);
        return move("wrap_up", SUMMARY);
      },
    });

    say("Yes please, I'm done.");
    await tick();
    expect(voice.spoken).toEqual(["Okay, let's wrap up."]);
    expect(ended).toEqual([]); // /end waits until the duck has finished speaking

    duckFinishedSpeaking();
    await tick();
    expect(ended).toEqual(["wrap_up"]);
    expect(voice.spoken).toEqual(["Okay, let's wrap up.", SUMMARY]);
    expect(states(events).at(-1)).not.toBe("ended"); // the summary has not been heard yet

    duckFinishedSpeaking();
    expect(states(events).at(-1)).toBe("ended");
    expect(voice.stopped).toBe(true);
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});

describe("when the student presses End", () => {
  it("speaks the summary from /end and only then finishes", async () => {
    const { session, events } = await startWith({
      ...mockTransport(),
      endSession: async () => move("wrap_up", SUMMARY),
    });

    await session.end();
    expect(voice.spoken).toEqual([SUMMARY]);
    expect(voice.stopped).toBe(false);

    duckFinishedSpeaking();
    expect(states(events).at(-1)).toBe("ended");
    expect(voice.stopped).toBe(true);
  });

  it("does not hang if /end fails: it says so and closes", async () => {
    const { session, events } = await startWith({
      ...mockTransport(),
      endSession: async () => {
        throw new HttpError("down", 500);
      },
    });
    await session.end();
    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(states(events).at(-1)).toBe("ended");
    expect(voice.stopped).toBe(true);
  });

  it("ignores a second End once the session has closed", async () => {
    const calls: string[] = [];
    const { session } = await startWith({
      ...mockTransport(),
      endSession: async (_id, reason) => {
        calls.push(reason);
        return move("wrap_up", SUMMARY);
      },
    });
    await session.end();
    duckFinishedSpeaking();
    await session.end();
    expect(calls).toHaveLength(1);
  });
});
