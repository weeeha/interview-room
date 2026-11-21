import { PCM_WORKLET_NAME, PCM_WORKLET_SOURCE } from "./pcm-worklet.ts";
import { Vad, type VadOptions } from "./vad.ts";
import { encodeWav16, resampleTo16k } from "./wav.ts";

export type CapturedUtterance = {
  /** 16 kHz mono 16-bit WAV. */
  wav: Blob;
  /** Milliseconds since the session start (the client clock), not counting the pre-roll. */
  speechStartMs: number;
  /** Milliseconds since the session start, at the moment the speaker went quiet. */
  speechEndMs: number;
};

export type CaptureOptions = {
  /** Silence that ends an utterance. Default 1200 (the END_OF_SPEECH_MS setting). */
  endOfSpeechMs?: number;
  /** Silence after which `onPause` is called. Default 0 (off); the room passes 550 from the server setting. */
  pauseMs?: number;
  /** performance.now() value that counts as time zero for the reported ms. Default: when capture starts. */
  sessionStartMs?: number;
  onUtterance: (u: CapturedUtterance) => void;
  /**
   * Called once when a pause (the VAD's `pauseMs`, about 550 ms) has gone by inside an utterance, with the audio up to
   * the start of that silence. If the silence lasts until the end of speech, `onUtterance` gets the same audio.
   */
  onPause?: (u: CapturedUtterance) => void;
  /** Called when speech is first detected, with ms since the session start. */
  onSpeechStart?: (atMs: number) => void;
  /** Called with the smoothed mic level (0 to 1) about 20 times a second. */
  onLevel?: (level: number) => void;
  vad?: VadOptions;
};

export type MicErrorCode = "denied" | "no-device" | "unsupported" | "failed";

export class MicError extends Error {
  readonly code: MicErrorCode;
  constructor(code: MicErrorCode, message: string) {
    super(message);
    this.name = "MicError";
    this.code = code;
  }
}

export type CaptureHandle = {
  /** Raise the speech threshold while the interviewer is audible, so echo is not heard as speech. */
  setInterviewerSpeaking(on: boolean): void;
  /** While muted nothing is detected or recorded, and any utterance in progress is dropped. */
  mute(on: boolean): void;
  readonly muted: boolean;
  /** Smoothed level, 0 to 1. */
  getLevel(): number;
  /** Release the microphone and close the audio graph. */
  stop(): void;
};

const PRE_ROLL_MS = 300;
const TAIL_MS = 300;

type Chunk = { t0: number; samples: Float32Array };

/**
 * The testable core: PCM chunks in, utterances out. No browser APIs.
 * Times are the audio clock (chunk start) in ms, plus offsetMs.
 */
export class CapturePipeline {
  readonly vad: Vad;
  private ring: Chunk[] = [];
  private utterance: Chunk[] = [];
  private recording = false;
  private startMs = 0;
  private samplesSeen = 0;
  private _muted = false;
  private level = 0;

  constructor(
    private sampleRate: number,
    private handlers: {
      onUtterance: (u: CapturedUtterance) => void;
      onPause?: (u: CapturedUtterance) => void;
      onSpeechStart?: (atMs: number) => void;
      onLevel?: (level: number) => void;
    },
    opts: { endOfSpeechMs?: number; pauseMs?: number; offsetMs?: number; vad?: VadOptions } = {},
  ) {
    this.vad = new Vad({ endOfSpeechMs: opts.endOfSpeechMs, pauseMs: opts.pauseMs, ...opts.vad });
    this.offsetMs = opts.offsetMs ?? 0;
  }

  private offsetMs: number;

  get muted(): boolean {
    return this._muted;
  }

  getLevel(): number {
    return this.level;
  }

  setInterviewerSpeaking(on: boolean): void {
    this.vad.setInterviewerSpeaking(on);
  }

  mute(on: boolean): void {
    if (on === this._muted) return;
    this._muted = on;
    if (on) {
      this.ring = [];
      this.utterance = [];
      this.recording = false;
      this.vad.reset();
      this.level = 0;
      this.handlers.onLevel?.(0);
    }
  }

  feed(samples: Float32Array): void {
    const t0 = (this.samplesSeen / this.sampleRate) * 1000;
    this.samplesSeen += samples.length;
    if (this._muted) return;

    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += (samples[i] ?? 0) ** 2;
    const rms = Math.sqrt(sum / Math.max(1, samples.length));
    // Mic speech sits around 0.02 to 0.3 RMS. A square root curve spreads that over the meter.
    const target = Math.min(1, Math.sqrt(rms) * 1.6);
    this.level = target > this.level ? target : this.level * 0.85 + target * 0.15;
    this.handlers.onLevel?.(this.level);

    const chunk: Chunk = { t0, samples };
    this.ring.push(chunk);
    if (this.recording) this.utterance.push(chunk);

    for (const ev of this.vad.push(rms, t0)) {
      if (ev.type === "speechStart") {
        this.recording = true;
        this.startMs = ev.atMs;
        this.utterance = this.ring.filter((c) => c.t0 + this.chunkMs(c) > ev.atMs - PRE_ROLL_MS);
        this.handlers.onSpeechStart?.(ev.atMs + this.offsetMs);
      } else if (ev.type === "pause") {
        if (this.recording && this.handlers.onPause) {
          const u = this.build(this.utterance, ev.atMs);
          if (u) this.handlers.onPause(u);
        }
      } else if (this.recording) {
        this.finish(ev.atMs);
      }
    }

    if (!this.recording) {
      const keepFrom = t0 - (PRE_ROLL_MS + 300);
      while (this.ring.length > 0 && (this.ring[0] as Chunk).t0 < keepFrom) this.ring.shift();
    } else {
      this.ring = [];
    }
  }

  private chunkMs(c: Chunk): number {
    return (c.samples.length / this.sampleRate) * 1000;
  }

  private finish(silenceStartMs: number): void {
    const chunks = this.utterance;
    this.utterance = [];
    this.recording = false;
    this.ring = [];
    const u = this.build(chunks, silenceStartMs);
    if (u) this.handlers.onUtterance(u);
  }

  /** The utterance from `chunks`, cut 300 ms after `silenceStartMs`. Does not change any state. */
  private build(chunks: Chunk[], silenceStartMs: number): CapturedUtterance | null {
    if (chunks.length === 0) return null;
    const first = (chunks[0] as Chunk).t0;
    const total = chunks.reduce((n, c) => n + c.samples.length, 0);
    const all = new Float32Array(total);
    let o = 0;
    for (const c of chunks) {
      all.set(c.samples, o);
      o += c.samples.length;
    }
    const endIndex = Math.min(total, Math.max(0, Math.round(((silenceStartMs + TAIL_MS - first) / 1000) * this.sampleRate)));
    const pcm = resampleTo16k(all.subarray(0, endIndex), this.sampleRate);
    return {
      wav: new Blob([encodeWav16(pcm)], { type: "audio/wav" }),
      speechStartMs: this.startMs + this.offsetMs,
      speechEndMs: silenceStartMs + this.offsetMs,
    };
  }
}

function micErrorFrom(err: unknown): MicError {
  const name = err instanceof DOMException || err instanceof Error ? err.name : "";
  const detail = err instanceof Error ? err.message : String(err);
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
    return new MicError("denied", "Microphone access was denied. Allow it in the browser address bar and try again.");
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") {
    return new MicError("no-device", "No microphone was found.");
  }
  return new MicError("failed", `The microphone could not start: ${detail}`);
}

/**
 * Open the microphone and start detecting speech. Call it from a click or key handler, because
 * Safari and Chrome keep an AudioContext suspended until the user has acted on the page.
 * Rejects with a MicError.
 */
export async function startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new MicError("unsupported", "This browser cannot capture the microphone (it needs a secure page, such as localhost).");
  }
  const Ctor: typeof AudioContext | undefined =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new MicError("unsupported", "This browser has no Web Audio support.");

  // Create and resume the context first, while the click is still fresh.
  const ctx = new Ctor({ latencyHint: "interactive" });
  void ctx.resume().catch(() => {});

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
  } catch (err) {
    void ctx.close().catch(() => {});
    throw micErrorFrom(err);
  }
  if (ctx.state !== "running") await ctx.resume().catch(() => {});

  const now = performance.now();
  const sessionStart = opts.sessionStartMs ?? now;
  const pipeline = new CapturePipeline(ctx.sampleRate, opts, {
    endOfSpeechMs: opts.endOfSpeechMs,
    pauseMs: opts.pauseMs,
    offsetMs: now - sessionStart,
    vad: opts.vad,
  });

  const source = ctx.createMediaStreamSource(stream);
  // A node that reaches the destination keeps the graph pulled in Safari. It is silent.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sink.connect(ctx.destination);

  let node: AudioNode;
  let stopped = false;
  try {
    if (!ctx.audioWorklet) throw new Error("no audioWorklet");
    const url = URL.createObjectURL(new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const worklet = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!stopped) pipeline.feed(e.data);
    };
    node = worklet;
  } catch {
    // Older browsers: ScriptProcessor runs on the main thread but gives the same samples.
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    sp.onaudioprocess = (e) => {
      if (!stopped) pipeline.feed(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    node = sp;
  }
  source.connect(node);
  node.connect(sink);

  return {
    setInterviewerSpeaking: (on) => pipeline.setInterviewerSpeaking(on),
    mute(on) {
      pipeline.mute(on);
      for (const t of stream.getAudioTracks()) t.enabled = !on;
    },
    get muted() {
      return pipeline.muted;
    },
    getLevel: () => pipeline.getLevel(),
    stop() {
      if (stopped) return;
      stopped = true;
      for (const t of stream.getTracks()) t.stop();
      source.disconnect();
      node.disconnect();
      void ctx.close().catch(() => {});
    },
  };
}
