/**
 * Energy voice activity detector. Pure: feed it one RMS value per frame with the frame time in ms.
 *
 * - The first `calibrationMs` set the noise floor (median RMS). No events are emitted meanwhile.
 * - Speech starts after `startMs` of continuous frames above the threshold.
 * - Speech ends after `endOfSpeechMs` of continuous frames below it.
 * - While the interviewer is speaking a higher threshold applies, so speaker echo is not heard as speech.
 */

export type VadEvent =
  /** atMs is the time the above-threshold run began. */
  | { type: "speechStart"; atMs: number }
  /** atMs is the time the silence began. detectedAtMs is when the end was decided. */
  | { type: "speechEnd"; atMs: number; detectedAtMs: number };

export type VadOptions = {
  startMs?: number;
  endOfSpeechMs?: number;
  calibrationMs?: number;
  /** Threshold is the noise floor times this. */
  floorMultiplier?: number;
  /** Lowest threshold in a silent room (RMS, 0 to 1). */
  minThreshold?: number;
  /** Extra factor on the threshold while the interviewer speaks. */
  interviewerMultiplier?: number;
  /** Lowest threshold while the interviewer speaks. */
  interviewerMinThreshold?: number;
};

const DEFAULTS: Required<VadOptions> = {
  startMs: 150,
  endOfSpeechMs: 1200,
  calibrationMs: 500,
  floorMultiplier: 3,
  minThreshold: 0.015,
  interviewerMultiplier: 2.5,
  interviewerMinThreshold: 0.04,
};

export class Vad {
  private o: Required<VadOptions>;
  private floor = 0;
  private calibStart: number | null = null;
  private calibFrames: number[] = [];
  private _calibrating = true;
  private _inSpeech = false;
  private interviewerSpeaking = false;
  private runStart: number | null = null; // start of the current above-threshold run
  private silenceStart: number | null = null; // start of the current below-threshold run in speech

  constructor(opts: VadOptions = {}) {
    // Skip undefined values so an unset option keeps its default.
    const set = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
    this.o = { ...DEFAULTS, ...set };
  }

  get calibrating(): boolean {
    return this._calibrating;
  }

  get inSpeech(): boolean {
    return this._inSpeech;
  }

  /** Current speech threshold (RMS). */
  get threshold(): number {
    const base = Math.max(this.o.minThreshold, this.floor * this.o.floorMultiplier);
    return this.interviewerSpeaking ? Math.max(this.o.interviewerMinThreshold, base * this.o.interviewerMultiplier) : base;
  }

  setInterviewerSpeaking(on: boolean): void {
    this.interviewerSpeaking = on;
  }

  /** Back to calibration. Keeps the interviewerSpeaking flag. */
  reset(): void {
    this.floor = 0;
    this.calibStart = null;
    this.calibFrames = [];
    this._calibrating = true;
    this._inSpeech = false;
    this.runStart = null;
    this.silenceStart = null;
  }

  push(rms: number, tMs: number): VadEvent[] {
    if (this._calibrating) {
      this.calibStart ??= tMs;
      this.calibFrames.push(rms);
      // Frame times are frame starts, so the frame at tMs covers up to tMs plus one frame.
      const frameMs = this.calibFrames.length > 1 ? (tMs - this.calibStart) / (this.calibFrames.length - 1) : 0;
      if (tMs - this.calibStart + frameMs >= this.o.calibrationMs - 1e-6) {
        const sorted = [...this.calibFrames].sort((a, b) => a - b);
        this.floor = sorted[Math.floor(sorted.length / 2)] ?? 0;
        this._calibrating = false;
      }
      return [];
    }

    const above = rms > this.threshold;
    const events: VadEvent[] = [];

    if (!this._inSpeech) {
      if (above) {
        this.runStart ??= tMs;
        if (tMs - this.runStart >= this.o.startMs) {
          this._inSpeech = true;
          this.silenceStart = null;
          events.push({ type: "speechStart", atMs: this.runStart });
          this.runStart = null;
        }
      } else {
        this.runStart = null;
        // Track slow changes in room noise while idle.
        // Not while the interviewer speaks: that sound is echo, not the room.
        if (!this.interviewerSpeaking) this.floor = this.floor * 0.98 + rms * 0.02;
      }
      return events;
    }

    if (above) {
      this.silenceStart = null;
    } else {
      this.silenceStart ??= tMs;
      if (tMs - this.silenceStart >= this.o.endOfSpeechMs) {
        events.push({ type: "speechEnd", atMs: this.silenceStart, detectedAtMs: tMs });
        this._inSpeech = false;
        this.silenceStart = null;
      }
    }
    return events;
  }
}
