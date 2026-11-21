import { describe, expect, it } from "vitest";
import { Vad, type VadEvent } from "./vad.ts";

const FRAME = 20;

/** Feed `ms` of constant rms starting at `from`; return events and the next time. */
function feed(vad: Vad, from: number, ms: number, rms: number) {
  const events: VadEvent[] = [];
  let t = from;
  for (; t < from + ms; t += FRAME) events.push(...vad.push(rms, t));
  return { events, t };
}

const QUIET = 0.004;
const SPEECH = 0.1;

function calibrated(opts = {}) {
  const vad = new Vad({ endOfSpeechMs: 1200, ...opts });
  const { t } = feed(vad, 0, 500, QUIET);
  return { vad, t };
}

describe("vad", () => {
  it("test_vad_no_events_in_silence", () => {
    const { vad, t } = calibrated();
    expect(feed(vad, t, 3000, QUIET).events).toEqual([]);
  });

  it("test_vad_start_after_150ms", () => {
    const { vad, t } = calibrated();
    const r = feed(vad, t, 140, SPEECH);
    expect(r.events).toEqual([]);
    const r2 = feed(vad, r.t, 40, SPEECH);
    expect(r2.events).toHaveLength(1);
    expect(r2.events[0]?.type).toBe("speechStart");
    expect(r2.events[0]?.atMs).toBe(t);
  });

  it("test_vad_short_blip_ignored", () => {
    const { vad, t } = calibrated();
    const a = feed(vad, t, 100, SPEECH);
    const b = feed(vad, a.t, 500, QUIET);
    const c = feed(vad, b.t, 100, SPEECH);
    expect([...a.events, ...b.events, ...c.events]).toEqual([]);
  });

  it("test_vad_end_after_window", () => {
    const { vad, t } = calibrated();
    const a = feed(vad, t, 1000, SPEECH);
    expect(a.events.map((e) => e.type)).toEqual(["speechStart"]);
    const b = feed(vad, a.t, 1180, QUIET);
    expect(b.events).toEqual([]);
    const c = feed(vad, b.t, 40, QUIET);
    expect(c.events).toHaveLength(1);
    expect(c.events[0]?.type).toBe("speechEnd");
    expect(c.events[0]?.atMs).toBe(a.t); // silence began here
  });

  it("test_vad_pause_shorter_than_window_does_not_end", () => {
    const { vad, t } = calibrated();
    const a = feed(vad, t, 1000, SPEECH);
    const b = feed(vad, a.t, 900, QUIET);
    const c = feed(vad, b.t, 1000, SPEECH);
    const d = feed(vad, c.t, 1300, QUIET);
    const types = [...a.events, ...b.events, ...c.events, ...d.events].map((e) => e.type);
    expect(types).toEqual(["speechStart", "speechEnd"]);
  });

  it("test_vad_two_utterances", () => {
    const { vad, t } = calibrated();
    const a = feed(vad, t, 600, SPEECH);
    const b = feed(vad, a.t, 1400, QUIET);
    const c = feed(vad, b.t, 600, SPEECH);
    const d = feed(vad, c.t, 1400, QUIET);
    expect([...a.events, ...b.events, ...c.events, ...d.events].map((e) => e.type)).toEqual([
      "speechStart",
      "speechEnd",
      "speechStart",
      "speechEnd",
    ]);
  });

  it("test_vad_higher_threshold_while_interviewer_speaks", () => {
    const { vad, t } = calibrated();
    const moderate = 0.03; // above the normal threshold, below the interviewer one
    vad.setInterviewerSpeaking(true);
    const a = feed(vad, t, 1000, moderate);
    expect(a.events).toEqual([]);
    const b = feed(vad, a.t, 400, SPEECH);
    expect(b.events.map((e) => e.type)).toEqual(["speechStart"]);
    vad.reset();
    const c = calibrated();
    const d = feed(c.vad, c.t, 400, moderate);
    expect(d.events.map((e) => e.type)).toEqual(["speechStart"]);
  });

  it("test_vad_noise_floor_adapts_to_loud_room", () => {
    const vad = new Vad();
    const a = feed(vad, 0, 500, 0.03); // loud room during calibration
    const b = feed(vad, a.t, 1500, 0.03);
    expect(b.events).toEqual([]);
    expect(vad.threshold).toBeGreaterThan(0.05);
    const c = feed(vad, b.t, 400, 0.3);
    expect(c.events.map((e) => e.type)).toEqual(["speechStart"]);
  });

  it("test_vad_no_events_during_calibration", () => {
    const vad = new Vad();
    expect(feed(vad, 0, 400, SPEECH).events).toEqual([]);
  });

  it("test_vad_reset_returns_to_calibration", () => {
    const { vad, t } = calibrated();
    feed(vad, t, 600, SPEECH);
    expect(vad.inSpeech).toBe(true);
    vad.reset();
    expect(vad.inSpeech).toBe(false);
    expect(vad.calibrating).toBe(true);
  });
});

describe("vad options", () => {
  it("test_vad_undefined_option_keeps_default", () => {
    const vad = new Vad({ endOfSpeechMs: undefined });
    const a = feed(vad, 0, 500, QUIET);
    const b = feed(vad, a.t, 600, SPEECH);
    const c = feed(vad, b.t, 1300, QUIET);
    expect([...b.events, ...c.events].map((e) => e.type)).toEqual(["speechStart", "speechEnd"]);
  });
});
