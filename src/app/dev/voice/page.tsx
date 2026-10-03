"use client";

// Dev A's throwaway test page for the duck loop. Not part of the product UI.
import { useRef, useState } from "react";
import { DuckSession, type DuckSessionEvent, type DuckState } from "@/lib/voice/duckSession";
import { httpTransport, mockTransport } from "@/lib/voice/transport";

interface Row {
  id: number;
  at: string;
  kind: "student" | "duck" | "system";
  text: string;
}

function clock(iso: string) {
  return new Date(iso).toISOString().slice(11, 23);
}

const STATE_COLOURS: Record<DuckState, string> = {
  idle: "bg-zinc-300 text-black",
  listening: "bg-green-500 text-white",
  thinking: "bg-amber-400 text-black",
  speaking: "bg-blue-500 text-white",
  paused: "bg-purple-500 text-white",
  ended: "bg-red-600 text-white",
};

export default function VoiceSpikePage() {
  const sessionRef = useRef<DuckSession | null>(null);
  const nextId = useRef(0);

  const [state, setState] = useState<DuckState>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [mode, setMode] = useState<"mock" | "real">("mock");
  const [slowServer, setSlowServer] = useState(false);
  const [sectionId, setSectionId] = useState("sec_1");
  const [topic, setTopic] = useState("Binary search");
  const [confidence, setConfidence] = useState(4);
  const [partial, setPartial] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  function addRow(kind: Row["kind"], text: string, at = new Date().toISOString()) {
    const id = nextId.current++;
    setRows((prev) => [...prev, { id, at, kind, text }]);
  }

  async function loadDevices() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === "audioinput"));
  }

  function onEvent(event: DuckSessionEvent) {
    switch (event.type) {
      case "state":
        setState(event.state);
        addRow("system", `state: ${event.state}`);
        break;
      case "started":
        addRow("system", `session ${event.start.sessionId} started`);
        break;
      case "move":
        addRow("duck", `(${event.source}: ${event.move.kind} ${event.move.level}) ${event.move.line}`);
        break;
      case "student_turn": {
        const { text, startedAt, endedAt, silenceBeforeMs } = event.turn;
        setPartial("");
        addRow("student", `${text}  (${((Date.parse(endedAt) - Date.parse(startedAt)) / 1000).toFixed(1)} s, silence before: ${silenceBeforeMs} ms)`);
        break;
      }
      case "partial":
        setPartial(event.text);
        break;
      case "filler":
        addRow("duck", `(filler) Hmm, let me think.`);
        break;
      case "silence_timer":
        addRow("system", `silence timer fired: ${event.ms / 1000} s, asking /silence`);
        break;
      case "dropped_reply":
        addRow("system", `reply dropped: ${event.reason}`);
        break;
      case "error":
        addRow("system", `ERROR: ${event.message}`);
        break;
      case "voice":
        if (event.event.type === "barge_in") addRow("system", "barge-in: duck audio stopped", event.event.at);
        if (event.event.type === "waiting_unfinished_thought") addRow("system", "ends with a filler word, waiting longer");
        break;
    }
  }

  function start() {
    setRows([]);
    const session = new DuckSession(
      {
        sectionId,
        topic,
        confidence,
        deviceId: deviceId || undefined,
        transport: mode === "mock" ? mockTransport({ turnDelayMs: slowServer ? 3_000 : 0 }) : httpTransport,
      },
      onEvent,
    );
    sessionRef.current = session;
    void session.start();
  }

  const running = state !== "idle" && state !== "ended";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8 font-sans">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Duck loop test</h1>
        <span className={`rounded-full px-4 py-1 text-sm font-semibold ${STATE_COLOURS[state]}`}>{state}</span>
      </header>

      <section className="flex flex-wrap items-center gap-3 text-sm">
        <select className="rounded border px-3 py-2" value={mode} onChange={(e) => setMode(e.target.value as "mock" | "real")} disabled={running}>
          <option value="mock">Mock server (no database)</option>
          <option value="real">Real server (/api/sessions)</option>
        </select>
        {mode === "mock" ? (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={slowServer} onChange={(e) => setSlowServer(e.target.checked)} disabled={running} />
            Slow server (3 s), to hear the filler
          </label>
        ) : (
          <>
            <input className="w-24 rounded border px-2 py-2" value={sectionId} onChange={(e) => setSectionId(e.target.value)} disabled={running} />
            <input className="w-40 rounded border px-2 py-2" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={running} />
            <label className="flex items-center gap-2">
              Confidence
              <select className="rounded border px-2 py-2" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} disabled={running}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <button className="rounded border px-3 py-2" onClick={loadDevices} disabled={running}>
          List mics
        </button>
        <select className="rounded border px-3 py-2" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={running}>
          <option value="">Default mic</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
        {running ? (
          <>
            <button className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black" onClick={() => void sessionRef.current?.end()}>
              End (wrap-up)
            </button>
            <button className="rounded bg-red-600 px-4 py-2 text-white" onClick={() => sessionRef.current?.stop()}>
              Stop now
            </button>
          </>
        ) : (
          <button className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black" onClick={start}>
            Start
          </button>
        )}
      </section>

      <section className="flex flex-col gap-1 rounded border p-4 font-mono text-sm">
        {rows.length === 0 && <p className="text-zinc-500">Press Start. The duck speaks first, then you explain.</p>}
        {rows.map((row) => (
          <p key={row.id} className={row.kind === "duck" ? "text-amber-600" : row.kind === "system" ? "text-zinc-500" : ""}>
            <span className="text-zinc-400">{clock(row.at)}</span> [{row.kind}] {row.text}
          </p>
        ))}
        {partial && <p className="text-zinc-400 italic">… {partial}</p>}
      </section>
    </main>
  );
}
