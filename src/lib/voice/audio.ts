// Browser-only audio helpers: mic capture to PCM16 and gapless PCM16 playback.
// Grok Voice expects 24 kHz mono PCM16 little-endian in both directions.

export const SAMPLE_RATE = 24_000;
const CHUNK_SAMPLES = SAMPLE_RATE / 10;

const CAPTURE_WORKLET = `
class DuckCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("duck-capture", DuckCapture);
`;

export interface Mic {
  stop(): void;
}

export async function startMic(
  deviceId: string | undefined,
  onChunk: (pcm16: ArrayBuffer, level: number) => void,
): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  // Chrome starts the context suspended when the mic permission prompt outlasts the click.
  if (context.state === "suspended") await context.resume();
  const moduleUrl = URL.createObjectURL(
    new Blob([CAPTURE_WORKLET], { type: "application/javascript" }),
  );
  await context.audioWorklet.addModule(moduleUrl);
  URL.revokeObjectURL(moduleUrl);

  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, "duck-capture");
  // The worklet only runs while connected to the destination; keep it silent.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(capture).connect(mute).connect(context.destination);

  let pending: Float32Array[] = [];
  let pendingLength = 0;
  capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
    pending.push(event.data);
    pendingLength += event.data.length;
    if (pendingLength < CHUNK_SAMPLES) return;
    const merged = new Float32Array(pendingLength);
    let offset = 0;
    for (const part of pending) {
      merged.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingLength = 0;
    let peak = 0;
    for (const s of merged) peak = Math.max(peak, Math.abs(s));
    onChunk(floatToPcm16(merged), peak);
  };

  return {
    stop() {
      capture.port.onmessage = null;
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}

export class PcmPlayer {
  private context = new AudioContext({ sampleRate: SAMPLE_RATE });
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  onIdle?: () => void;

  get playing() {
    return this.sources.size > 0;
  }

  play(pcm16: ArrayBuffer) {
    const samples = pcm16ToFloat(pcm16);
    if (samples.length === 0) return;
    if (this.context.state === "suspended") void this.context.resume();

    const buffer = this.context.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);

    const startAt = Math.max(this.context.currentTime, this.nextStart);
    source.start(startAt);
    this.nextStart = startAt + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onIdle?.();
    };
  }

  stop() {
    const sources = [...this.sources];
    this.sources.clear();
    this.nextStart = 0;
    for (const source of sources) {
      source.onended = null;
      source.stop();
    }
  }

  close() {
    this.stop();
    void this.context.close();
  }
}

function floatToPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

function pcm16ToFloat(pcm16: ArrayBuffer): Float32Array<ArrayBuffer> {
  const ints = new Int16Array(pcm16, 0, Math.floor(pcm16.byteLength / 2));
  const out = new Float32Array(ints.length);
  for (let i = 0; i < ints.length; i++) out[i] = ints[i] / 0x8000;
  return out;
}

export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
