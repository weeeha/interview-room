import { describe, expect, it } from "vitest";
import { CapturePipeline, type CapturedUtterance } from "./capture.ts";

const RATE = 48000;
const CHUNK = 512;

function make(extra: { offsetMs?: number; pauseMs?: number } = {}) {
  const got: CapturedUtterance[] = [];
  const paused: CapturedUtterance[] = [];
  const starts: number[] = [];
  const levels: number[] = [];
  const p = new CapturePipeline(
    RATE,
    { onUtterance: (u) => got.push(u), onPause: (u) => paused.push(u), onSpeechStart: (t) => starts.push(t), onLevel: (l) => levels.push(l) },
    extra,
  );
  return { p, got, paused, starts, levels };
}

/** Feed `ms` of a 200 Hz tone (amp) or quiet noise. */
function play(p: CapturePipeline, ms: number, amp: number) {
  const n = Math.round((ms / 1000) * RATE / CHUNK);
  for (let c = 0; c < n; c++) {
    const buf = new Float32Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) buf[i] = amp * Math.sin((2 * Math.PI * 200 * i) / RATE) + (Math.random() - 0.5) * 0.002;
    p.feed(buf);
  }
}

async function wavSamples(blob: Blob): Promise<number> {
  const buf = new DataView(await blob.arrayBuffer());
  expect(buf.getUint32(24, true)).toBe(16000);
  return buf.getUint32(40, true) / 2;
}

describe("capture pipeline", () => {
  it("test_capture_emits_one_utterance_with_preroll", async () => {
    const { p, got, starts } = make();
    play(p, 1000, 0.002); // calibration plus idle
    play(p, 2000, 0.2); // speech, 2 s
    play(p, 1500, 0.002); // silence beyond the 1200 ms window
    expect(got).toHaveLength(1);
    expect(starts).toHaveLength(1);
    const u = got[0] as CapturedUtterance;
    expect(u.speechStartMs).toBeGreaterThan(990);
    expect(u.speechStartMs).toBeLessThan(1040);
    expect(u.speechEndMs).toBeGreaterThan(2990);
    expect(u.speechEndMs).toBeLessThan(3050);
    // 300 ms pre-roll + 2000 ms speech + 300 ms tail = 2.6 s, at 16 kHz
    const n = await wavSamples(u.wav);
    expect(n).toBeGreaterThan(2.5 * 16000);
    expect(n).toBeLessThan(2.7 * 16000);
  });

  it("test_capture_offset_shifts_times", () => {
    const { p, got } = make({ offsetMs: 5000 });
    play(p, 1000, 0.002);
    play(p, 1000, 0.2);
    play(p, 1500, 0.002);
    expect((got[0] as CapturedUtterance).speechStartMs).toBeGreaterThan(5990);
  });

  it("test_capture_mute_drops_utterance", () => {
    const { p, got } = make();
    play(p, 1000, 0.002);
    play(p, 500, 0.2);
    p.mute(true);
    play(p, 3000, 0.2);
    expect(got).toHaveLength(0);
    expect(p.getLevel()).toBe(0);
  });

  it("test_capture_ignores_echo_while_interviewer_speaks", () => {
    const { p, got } = make();
    play(p, 1000, 0.002);
    p.setInterviewerSpeaking(true);
    play(p, 2000, 0.03);
    play(p, 1500, 0.002);
    expect(got).toHaveLength(0);
  });

  it("test_capture_level_rises_with_speech", () => {
    const { p, levels } = make();
    play(p, 1000, 0.002);
    const quiet = Math.max(...levels);
    play(p, 500, 0.2);
    expect(Math.max(...levels)).toBeGreaterThan(quiet + 0.3);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
  });

  it("test_capture_pause_audio_is_byte_identical_to_the_final_utterance", async () => {
    const { p, got, paused } = make({ pauseMs: 550 });
    play(p, 1000, 0.002);
    play(p, 2000, 0.2);
    play(p, 700, 0.002); // past the 550 ms pause, not yet the 1200 ms end
    expect(paused).toHaveLength(1);
    expect(got).toHaveLength(0);
    play(p, 800, 0.002);
    expect(got).toHaveLength(1);
    const a = new Uint8Array(await (paused[0] as CapturedUtterance).wav.arrayBuffer());
    const b = new Uint8Array(await (got[0] as CapturedUtterance).wav.arrayBuffer());
    expect(a.length).toBe(b.length);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect((paused[0] as CapturedUtterance).speechEndMs).toBe((got[0] as CapturedUtterance).speechEndMs);
  });

  it("test_capture_pause_audio_differs_when_speech_goes_on", async () => {
    const { p, got, paused } = make({ pauseMs: 550 });
    play(p, 1000, 0.002);
    play(p, 1500, 0.2);
    play(p, 700, 0.002);
    play(p, 1500, 0.2); // the speaker was only thinking
    play(p, 1500, 0.002);
    expect(paused).toHaveLength(2); // one per silence
    expect(got).toHaveLength(1);
    const a = (paused[0] as CapturedUtterance).wav.size;
    const b = (got[0] as CapturedUtterance).wav.size;
    expect(b).toBeGreaterThan(a + 16000);
  });

  it("test_capture_no_pause_event_when_off_or_by_default", () => {
    const { p, got, paused } = make();
    play(p, 1000, 0.002);
    play(p, 1500, 0.2);
    play(p, 1500, 0.002);
    expect(paused).toHaveLength(0);
    expect(got).toHaveLength(1);
  });
});
