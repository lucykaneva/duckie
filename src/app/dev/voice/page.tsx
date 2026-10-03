"use client";

// Dev A's throwaway voice spike page. Not part of the product UI.
import { useRef, useState } from "react";
import type { DuckMove } from "@/lib/duck/types";
import { DuckVoice, type VoiceEvent, type VoiceStatus } from "@/lib/voice/session";

interface Row {
  id: number;
  at: string;
  who: "student" | "duck" | "system";
  text: string;
}

const DEFAULT_LINE = "Ooh! Can you explain it to me? I'm just a duck.";

function clock(iso: string) {
  return new Date(iso).toISOString().slice(11, 23);
}

export default function VoiceSpikePage() {
  const voiceRef = useRef<DuckVoice | null>(null);
  const nextId = useRef(0);
  const sendToTurnRef = useRef(false);

  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [partial, setPartial] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [serverEvents, setServerEvents] = useState<string[]>([]);
  const [line, setLine] = useState(DEFAULT_LINE);
  const [sendToTurn, setSendToTurn] = useState(false);
  const [mic, setMic] = useState({ peak: 0, chunksSent: 0 });

  function addRow(who: Row["who"], text: string, at = new Date().toISOString()) {
    const id = nextId.current++;
    setRows((prev) => [...prev, { id, at, who, text }]);
  }

  async function loadDevices() {
    await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) =>
      s.getTracks().forEach((t) => t.stop()),
    );
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(all.filter((d) => d.kind === "audioinput"));
  }

  async function askTurnEndpoint(text: string, startedAt: string, endedAt: string) {
    const res = await fetch("/api/sessions/dev/turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, startedAt, endedAt, silenceBeforeMs: 0 }),
    });
    const move = (await res.json()) as DuckMove;
    voiceRef.current?.speak(move.line);
  }

  function onEvent(event: VoiceEvent) {
    switch (event.type) {
      case "status":
        setStatus(event.status);
        break;
      case "partial":
        setPartial(event.text);
        break;
      case "speech_started":
        addRow("system", "speech started", event.at);
        break;
      case "speech_stopped":
        addRow("system", "speech stopped (end of turn detected)", event.at);
        break;
      case "turn": {
        const { text, startedAt, endedAt } = event.turn;
        const seconds = (Date.parse(endedAt) - Date.parse(startedAt)) / 1000;
        setPartial("");
        addRow("student", `${text}  (${clock(startedAt)} to ${clock(endedAt)}, ${seconds.toFixed(1)} s)`);
        if (sendToTurnRef.current) void askTurnEndpoint(text, startedAt, endedAt);
        break;
      }
      case "duck_said":
        addRow("duck", event.text);
        break;
      case "barge_in":
        addRow("system", "barge-in: duck audio stopped", event.at);
        break;
      case "waiting_unfinished_thought":
        addRow("system", `ends with a filler word, waiting longer: "…${event.text.slice(-30)}"`);
        break;
      case "auto_response_cancelled":
        addRow("system", "Grok tried to answer on its own, cancelled");
        break;
      case "error":
        addRow("system", `ERROR: ${event.message}`);
        break;
      case "mic_level":
        setMic({ peak: event.peak, chunksSent: event.chunksSent });
        break;
      case "server":
        if (event.eventType === "session.updated") {
          const session = (event.raw as { session?: { turn_detection?: unknown } }).session;
          addRow("system", `session.updated, turn_detection: ${JSON.stringify(session?.turn_detection)}`);
        }
        setServerEvents((prev) => [`${clock(new Date().toISOString())} ${event.eventType}`, ...prev].slice(0, 80));
        break;
    }
  }

  function start() {
    const voice = new DuckVoice(onEvent);
    voiceRef.current = voice;
    void voice.start(deviceId || undefined);
  }

  function stop() {
    voiceRef.current?.stop();
    voiceRef.current = null;
  }

  const running = status === "connecting" || status === "listening" || status === "speaking";

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8 font-sans">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Voice spike</h1>
        <span className="rounded-full bg-zinc-200 px-3 py-1 text-sm font-medium dark:bg-zinc-800">
          {status}
        </span>
      </header>

      <section className="flex flex-wrap items-center gap-3">
        <button className="rounded border px-3 py-2" onClick={loadDevices}>
          List mics
        </button>
        <select
          className="rounded border px-3 py-2"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          disabled={running}
        >
          <option value="">Default mic</option>
          {devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || d.deviceId}
            </option>
          ))}
        </select>
        {running ? (
          <button className="rounded bg-red-600 px-4 py-2 text-white" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="rounded bg-black px-4 py-2 text-white dark:bg-white dark:text-black" onClick={start}>
            Start
          </button>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sendToTurn}
            onChange={(e) => {
              setSendToTurn(e.target.checked);
              sendToTurnRef.current = e.target.checked;
            }}
          />
          Send each turn to /turn and speak the reply
        </label>
      </section>

      <section className="flex items-center gap-3 text-sm">
        <span className="w-24">Mic level</span>
        <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-200 dark:bg-zinc-800">
          <div
            className="h-full bg-green-500 transition-[width] duration-75"
            style={{ width: `${Math.min(100, mic.peak * 200)}%` }}
          />
        </div>
        <span className="w-40 text-right font-mono">{mic.chunksSent} chunks sent</span>
      </section>

      <section className="flex gap-3">
        <input
          className="flex-1 rounded border px-3 py-2"
          value={line}
          onChange={(e) => setLine(e.target.value)}
        />
        <button
          className="rounded border px-3 py-2 disabled:opacity-40"
          disabled={status !== "listening" && status !== "speaking"}
          onClick={() => voiceRef.current?.speak(line)}
        >
          Speak exact line
        </button>
        <button
          className="rounded border px-3 py-2 disabled:opacity-40"
          disabled={status !== "speaking"}
          onClick={() => voiceRef.current?.hush()}
        >
          Hush
        </button>
      </section>

      <section className="flex flex-col gap-1 rounded border p-4 font-mono text-sm">
        {rows.length === 0 && <p className="text-zinc-500">Press Start and talk.</p>}
        {rows.map((row) => (
          <p
            key={row.id}
            className={
              row.who === "student"
                ? ""
                : row.who === "duck"
                  ? "text-amber-600"
                  : "text-zinc-500"
            }
          >
            <span className="text-zinc-400">{clock(row.at)}</span> [{row.who}] {row.text}
          </p>
        ))}
        {partial && <p className="text-zinc-400 italic">… {partial}</p>}
      </section>

      <details className="rounded border p-4">
        <summary className="cursor-pointer text-sm font-medium">Raw server events</summary>
        <pre className="mt-2 max-h-80 overflow-auto text-xs">{serverEvents.join("\n")}</pre>
      </details>
    </main>
  );
}
