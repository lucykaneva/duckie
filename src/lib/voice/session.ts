// Browser-only Grok Voice session. The duck never improvises: Grok is used for
// speech in (turn detection + transcripts) and to speak lines we hand it verbatim.
import { DUCK } from "@/lib/duck/config";
import { PcmPlayer, startMic, toBase64, fromBase64, type Mic } from "./audio";

const REALTIME_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-latest";
const FINAL_TRANSCRIPT_WAIT_MS = 1_000;
const LATE_TRANSCRIPT_SETTLE_MS = 150;
const UNFINISHED_THOUGHT_WORDS = new Set(["and", "so", "because", "like", "um", "uh"]);

function endsMidThought(text: string) {
  const lastWord = text.toLowerCase().match(/([a-z']+)[^a-z']*$/)?.[1];
  return lastWord !== undefined && UNFINISHED_THOUGHT_WORDS.has(lastWord);
}

export type VoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "closed"
  | "error";

export interface StudentTurn {
  text: string;
  startedAt: string;
  endedAt: string;
}

export type VoiceEvent =
  | { type: "status"; status: VoiceStatus }
  | { type: "speech_started"; at: string }
  | { type: "speech_stopped"; at: string }
  | { type: "partial"; text: string }
  | { type: "turn"; turn: StudentTurn }
  | { type: "duck_said"; text: string }
  | { type: "barge_in"; at: string }
  | { type: "auto_response_cancelled" }
  | { type: "waiting_unfinished_thought"; text: string }
  | { type: "mic_level"; peak: number; chunksSent: number }
  | { type: "server"; eventType: string; raw: unknown }
  | { type: "error"; message: string };

interface ServerEvent {
  type: string;
  delta?: string;
  transcript?: string;
  item_id?: string;
  error?: { message?: string };
}

export class DuckVoice {
  private ws: WebSocket | null = null;
  private mic: Mic | null = null;
  private player: PcmPlayer | null = null;
  private earlyAudio: ArrayBuffer[] = [];
  private speechStartedAt: string | null = null;
  private speechStoppedAt: string | null = null;
  private pendingLines: string[] = [];
  private status: VoiceStatus = "idle";
  private chunksSent = 0;
  private turnSegments = new Map<string, string>();
  private extendedForUnfinishedThought = false;
  private responseActive = false;
  private responseIsOurs = false;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private onEvent: (event: VoiceEvent) => void) {}

  async start(deviceId?: string) {
    this.setStatus("connecting");
    try {
      const tokenPromise = fetchToken();
      // Handled by the await below; without this the rejection fires while the mic prompt is open.
      tokenPromise.catch(() => {});
      // Start capturing before the socket opens so the first words are not lost.
      this.mic = await startMic(deviceId, (chunk, peak) => {
        this.sendAudio(chunk);
        this.emit({ type: "mic_level", peak, chunksSent: this.chunksSent });
      });
      this.player = new PcmPlayer();
      this.player.onIdle = () => {
        if (this.status === "speaking") this.setStatus("listening");
      };

      const token = await tokenPromise;
      const ws = new WebSocket(REALTIME_URL, [`xai-client-secret.${token}`]);
      this.ws = ws;
      ws.onopen = () => this.configure();
      ws.onmessage = (message) => this.handle(JSON.parse(message.data));
      ws.onerror = () => this.fail("WebSocket error");
      ws.onclose = (event) => {
        if (this.status !== "error") this.setStatus("closed");
        if (event.code !== 1000) {
          this.emit({ type: "error", message: `Socket closed (${event.code}) ${event.reason}` });
        }
      };
    } catch (error) {
      this.fail(error instanceof Error ? error.message : String(error));
    }
  }

  /** Speak an exact line, word for word, via xAI's force_message. */
  speak(line: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.pendingLines.push(line);
    this.send({
      type: "conversation.item.create",
      item: {
        type: "force_message",
        role: "assistant",
        interruptible: true,
        content: [{ type: "output_text", text: line }],
      },
    });
  }

  /** Stop the duck's audio immediately (barge-in, or the student hit stop). */
  hush() {
    this.player?.stop();
    if (this.responseActive) this.send({ type: "response.cancel" });
    if (this.status === "speaking") this.setStatus("listening");
  }

  stop() {
    this.clearFinalize();
    this.mic?.stop();
    this.player?.close();
    this.ws?.close(1000);
    this.mic = null;
    this.player = null;
    this.ws = null;
    this.setStatus("closed");
  }

  private configure() {
    this.send({
      type: "session.update",
      session: {
        voice: "eve",
        instructions:
          "You are a plush duck. Only ever say lines you are given. Never respond on your own.",
        turn_detection: {
          type: "server_vad",
          silence_duration_ms: DUCK.endOfTurnSilenceMs,
        },
        audio: {
          input: { format: { type: "audio/pcm", rate: 24_000 } },
          output: { format: { type: "audio/pcm", rate: 24_000 } },
        },
      },
    });
    // Sent separately: if xAI rejects one, the base config above stays in effect.
    this.send({
      type: "session.update",
      session: { audio: { input: { transcription: { model: "grok-transcribe" } } } },
    });
    this.send({
      type: "session.update",
      session: {
        turn_detection: {
          type: "server_vad",
          silence_duration_ms: DUCK.endOfTurnSilenceMs,
          create_response: false,
        },
      },
    });

    for (const chunk of this.earlyAudio) this.sendAudio(chunk);
    this.earlyAudio = [];
    this.setStatus("listening");
  }

  private handle(event: ServerEvent) {
    switch (event.type) {
      case "input_audio_buffer.speech_started": {
        const at = new Date().toISOString();
        if (!this.speechStartedAt) this.speechStartedAt = at;
        this.speechStoppedAt = null;
        this.extendedForUnfinishedThought = false;
        this.clearFinalize();
        this.emit({ type: "speech_started", at });
        if (this.player?.playing) {
          this.hush();
          this.emit({ type: "barge_in", at });
        }
        return;
      }
      case "input_audio_buffer.speech_stopped": {
        this.speechStoppedAt = new Date().toISOString();
        this.emit({ type: "speech_stopped", at: this.speechStoppedAt });
        // The last transcript usually lands a few hundred ms after this; wait for it.
        this.scheduleFinalize(FINAL_TRANSCRIPT_WAIT_MS);
        return;
      }
      // xAI sends the running transcript of the current utterance, several times, on both events.
      case "conversation.item.input_audio_transcription.updated":
      case "conversation.item.input_audio_transcription.completed": {
        const segment = event.transcript?.trim();
        if (!segment) return;
        this.turnSegments.set(event.item_id ?? "", segment);
        const text = [...this.turnSegments.values()].join(" ");
        if (this.speechStoppedAt) {
          this.scheduleFinalize(LATE_TRANSCRIPT_SETTLE_MS);
        } else {
          this.emit({ type: "partial", text });
        }
        return;
      }
      case "response.created": {
        this.responseActive = true;
        this.responseIsOurs = this.pendingLines.length > 0;
        // Every response must be a line we asked for. Cancel anything Grok starts on its own.
        if (!this.responseIsOurs) {
          this.send({ type: "response.cancel" });
          this.emit({ type: "auto_response_cancelled" });
        }
        break;
      }
      case "response.output_audio.delta":
      case "response.audio.delta": {
        if (!event.delta || !this.responseIsOurs) return;
        this.player?.play(fromBase64(event.delta));
        if (this.status !== "speaking") this.setStatus("speaking");
        return;
      }
      case "response.done": {
        this.responseActive = false;
        if (this.responseIsOurs) {
          const line = this.pendingLines.shift();
          if (line) this.emit({ type: "duck_said", text: line });
        }
        this.responseIsOurs = false;
        break;
      }
      case "error": {
        this.emit({ type: "error", message: event.error?.message ?? JSON.stringify(event) });
        break;
      }
    }
    this.emit({ type: "server", eventType: event.type, raw: event });
  }

  private scheduleFinalize(ms: number) {
    this.clearFinalize();
    this.finalizeTimer = setTimeout(() => this.finalizeTurn(), ms);
  }

  private clearFinalize() {
    if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
    this.finalizeTimer = null;
  }

  private finalizeTurn() {
    this.finalizeTimer = null;
    const text = [...this.turnSegments.values()].join(" ");
    if (endsMidThought(text) && !this.extendedForUnfinishedThought) {
      // Server VAD already waited endOfTurnSilenceMs; top it up to unfinishedThoughtWaitMs.
      // If the student starts talking again, speech_started cancels this and the turn continues.
      this.extendedForUnfinishedThought = true;
      this.emit({ type: "waiting_unfinished_thought", text });
      const silentSinceStopMs = this.speechStoppedAt ? Date.now() - Date.parse(this.speechStoppedAt) : 0;
      this.scheduleFinalize(
        Math.max(0, DUCK.unfinishedThoughtWaitMs - DUCK.endOfTurnSilenceMs - silentSinceStopMs),
      );
      return;
    }
    this.extendedForUnfinishedThought = false;
    const startedAt = this.speechStartedAt;
    const endedAt = this.speechStoppedAt;
    this.turnSegments.clear();
    this.speechStartedAt = null;
    this.speechStoppedAt = null;
    if (!text || !startedAt || !endedAt) return;
    this.emit({ type: "turn", turn: { text, startedAt, endedAt } });
  }

  private sendAudio(chunk: ArrayBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.earlyAudio.push(chunk);
      return;
    }
    this.send({ type: "input_audio_buffer.append", audio: toBase64(chunk) });
    this.chunksSent++;
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  private setStatus(status: VoiceStatus) {
    this.status = status;
    this.emit({ type: "status", status });
  }

  private fail(message: string) {
    this.setStatus("error");
    this.emit({ type: "error", message });
    this.mic?.stop();
    this.player?.close();
    this.mic = null;
    this.player = null;
  }

  private emit(event: VoiceEvent) {
    this.onEvent(event);
  }
}

async function fetchToken(): Promise<string> {
  const res = await fetch("/api/voice/token", { method: "POST" });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? `Token request failed (${res.status})`);
  return data.token;
}
