// Browser-only audio helpers: mic capture to PCM16 and gapless PCM16 playback.
// Grok Voice expects 24 kHz mono PCM16 little-endian in both directions.
//
// One AudioContext feeds the speaker. A second context, or a context forced to 24 kHz,
// makes a Bluetooth speaker (a JBL on A2DP) drop lines: the dev log still shows them,
// because the text is logged when the line is decided. The playback worklet stays
// connected the whole session so the speaker does not sleep between lines.

export const SAMPLE_RATE = 24_000;
const CHUNK_SAMPLES_AT = (rate: number) => Math.round(rate / 10);

const WORKLETS = `
class DuckCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("duck-capture", DuckCapture);

class DuckPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.epoch = 0;
    this.latestToken = 0;
    this.sentDrainFor = 0;
    this.port.onmessage = (event) => {
      const data = event.data;
      if (data.type === "epoch") {
        this.epoch = data.epoch;
        this.queue = [];
        this.offset = 0;
        this.latestToken = 0;
        this.sentDrainFor = 0;
        return;
      }
      if (data.type === "push" && data.epoch === this.epoch) {
        this.queue.push(data.samples);
        this.latestToken = data.token;
      }
    };
  }

  process(_inputs, outputs) {
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const step = 24000 / sampleRate;
    for (let i = 0; i < out.length; i++) {
      const sample = this.read();
      // Exact zeros let a Bluetooth speaker sleep and eat the next line. This dither is silent.
      out[i] = sample === 0 ? (Math.random() - 0.5) * 0.0002 : sample;
      this.advance(step);
    }
    if (this.queue.length === 0 && this.latestToken !== 0 && this.sentDrainFor !== this.latestToken) {
      this.sentDrainFor = this.latestToken;
      this.port.postMessage({ type: "drained", token: this.latestToken, epoch: this.epoch });
    }
    return true;
  }

  read() {
    if (this.queue.length === 0) return 0;
    const chunk = this.queue[0];
    const i0 = Math.floor(this.offset);
    if (i0 >= chunk.length) return 0;
    const frac = this.offset - i0;
    const s0 = chunk[i0];
    let s1 = i0 + 1 < chunk.length ? chunk[i0 + 1] : s0;
    if (i0 + 1 >= chunk.length && this.queue.length > 1 && this.queue[1].length > 0) s1 = this.queue[1][0];
    return s0 * (1 - frac) + s1 * frac;
  }

  advance(step) {
    this.offset += step;
    while (this.queue.length > 0 && this.offset >= this.queue[0].length) {
      this.offset -= this.queue[0].length;
      this.queue.shift();
    }
    if (this.queue.length === 0) this.offset = 0;
  }
}
registerProcessor("duck-playback", DuckPlayback);
`;

export interface Mic {
  stop(): void;
}

interface PlaybackMessage {
  type: "drained";
  token: number;
  epoch: number;
}

export class PcmPlayer {
  private context = new AudioContext();
  private playback: AudioWorkletNode | null = null;
  private pending: Float32Array[] = [];
  private epoch = 0;
  private tokens = 0;
  private acked = 0;
  /** 24 kHz samples pushed and not yet drained. Backup if the worklet's drain message is lost. */
  private queuedSamples = 0;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private ready: Promise<void>;
  private routed: Promise<void>;
  private markRouted!: () => void;
  private failRouted!: (error: Error) => void;
  onIdle?: () => void;

  constructor() {
    this.routed = new Promise((resolve, reject) => {
      this.markRouted = resolve;
      this.failRouted = reject;
    });
    this.ready = this.loadModule();
    this.context.onstatechange = () => {
      if (this.closed) return;
      if (this.context.state === "suspended") void this.context.resume();
    };
  }

  get playing() {
    return this.tokens !== this.acked;
  }

  /**
   * Call from the Start click, before any await, so the browser allows sound.
   * `sinkId` empty binds the current default output (the JBL, when macOS is using it).
   */
  async unlock(sinkId?: string) {
    const resumed = this.context.state === "suspended" ? this.context.resume() : Promise.resolve();
    try {
      await this.ready;
      const sink = this.context as AudioContext & { setSinkId?: (id: string) => Promise<void> };
      if (sink.setSinkId) {
        try {
          await sink.setSinkId(sinkId ?? "");
        } catch (error) {
          if (sinkId) throw error;
        }
      }
      await resumed;
      this.connectPlayback();
      this.markRouted();
    } catch (error) {
      const wrapped = error instanceof Error ? error : new Error(String(error));
      this.failRouted(wrapped);
      throw wrapped;
    }
  }

  async startMic(
    deviceId: string | undefined,
    onChunk: (pcm16: ArrayBuffer, level: number) => void,
  ): Promise<Mic> {
    const streamPromise = navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    streamPromise.catch(() => {});
    await this.routed;
    const stream = await streamPromise;
    if (this.closed) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("closed");
    }
    if (this.context.state === "suspended") await this.context.resume();

    const source = this.context.createMediaStreamSource(stream);
    const capture = new AudioWorkletNode(this.context, "duck-capture");
    // Same context as playback, gain 0: the worklet runs, and the JBL still sees one stream.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    source.connect(capture).connect(mute).connect(this.context.destination);

    const inputRate = this.context.sampleRate;
    const chunkSamples = CHUNK_SAMPLES_AT(inputRate);
    let pending: Float32Array[] = [];
    let pendingLength = 0;
    capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
      pending.push(event.data);
      pendingLength += event.data.length;
      if (pendingLength < chunkSamples) return;
      const merged = new Float32Array(pendingLength);
      let offset = 0;
      for (const part of pending) {
        merged.set(part, offset);
        offset += part.length;
      }
      pending = [];
      pendingLength = 0;
      let peak = 0;
      for (const sample of merged) peak = Math.max(peak, Math.abs(sample));
      onChunk(floatToPcm16(resample(merged, inputRate, SAMPLE_RATE)), peak);
    };

    return {
      stop() {
        capture.port.onmessage = null;
        capture.disconnect();
        mute.disconnect();
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
      },
    };
  }

  play(pcm16: ArrayBuffer) {
    const samples = pcm16ToFloat(pcm16);
    if (samples.length === 0) return;
    if (this.context.state === "suspended") void this.context.resume();
    if (!this.playback) {
      this.pending.push(samples);
      return;
    }
    this.push(samples);
  }

  /** Drop queued speech immediately. The silent stream stays up so the speaker does not sleep. */
  stop() {
    this.epoch += 1;
    this.tokens = 0;
    this.acked = 0;
    this.queuedSamples = 0;
    this.pending = [];
    this.clearDrainTimer();
    this.playback?.port.postMessage({ type: "epoch", epoch: this.epoch });
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    this.failRouted(new Error("closed"));
    this.playback?.disconnect();
    void this.context.close();
  }

  private async loadModule() {
    const url = URL.createObjectURL(new Blob([WORKLETS], { type: "application/javascript" }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private connectPlayback() {
    if (this.playback || this.closed) return;
    const node = new AudioWorkletNode(this.context, "duck-playback", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    node.port.onmessage = (event: MessageEvent<PlaybackMessage>) => {
      const data = event.data;
      if (data.type !== "drained" || data.epoch !== this.epoch) return;
      const wasPlaying = this.tokens !== this.acked;
      if (data.token > this.acked) this.acked = data.token;
      if (data.token === this.tokens) this.queuedSamples = 0;
      if (wasPlaying && this.acked === this.tokens) {
        this.clearDrainTimer();
        this.onIdle?.();
      }
    };
    node.connect(this.context.destination);
    this.playback = node;
    const queued = this.pending.splice(0);
    for (const samples of queued) this.push(samples);
  }

  private push(samples: Float32Array) {
    if (!this.playback || samples.length === 0) return;
    this.tokens += 1;
    this.queuedSamples += samples.length;
    const token = this.tokens;
    this.playback.port.postMessage({ type: "push", samples, epoch: this.epoch, token }, [samples.buffer]);
    this.scheduleDrain();
  }

  /** Wall-clock length of what we queued, plus a little. Fires only if the worklet never says it finished. */
  private scheduleDrain() {
    this.clearDrainTimer();
    if (this.queuedSamples === 0) return;
    const ms = (this.queuedSamples / SAMPLE_RATE) * 1000 + 1_200;
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      if (this.closed || this.tokens === this.acked) return;
      this.acked = this.tokens;
      this.queuedSamples = 0;
      this.onIdle?.();
    }, ms);
  }

  private clearDrainTimer() {
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = null;
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

/** Linear resample. The mic context runs at the hardware rate; Grok wants 24 kHz. */
function resample(samples: Float32Array<ArrayBuffer>, fromRate: number, toRate: number): Float32Array<ArrayBuffer> {
  if (samples.length === 0 || fromRate === toRate) return samples;
  const length = Math.max(1, Math.round((samples.length * toRate) / fromRate));
  const out = new Float32Array(length);
  const scale = (samples.length - 1) / Math.max(1, length - 1);
  for (let i = 0; i < length; i++) {
    const position = i * scale;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const mix = position - left;
    out[i] = samples[left] * (1 - mix) + samples[right] * mix;
  }
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
