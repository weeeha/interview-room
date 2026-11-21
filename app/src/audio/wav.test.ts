import { describe, expect, it } from "vitest";
import { encodeWav16, resampleTo16k } from "./wav.ts";

function sine(freq: number, rate: number, seconds: number): Float32Array {
  const out = new Float32Array(Math.round(rate * seconds));
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

describe("wav", () => {
  it("test_wav_header", () => {
    const bytes = encodeWav16(new Float32Array([0, 0.5, -0.5, 1, -1]));
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(tag(12)).toBe("fmt ");
    expect(tag(36)).toBe("data");
    expect(dv.getUint32(4, true)).toBe(bytes.length - 8);
    expect(dv.getUint16(20, true)).toBe(1); // PCM
    expect(dv.getUint16(22, true)).toBe(1); // mono
    expect(dv.getUint32(24, true)).toBe(16000);
    expect(dv.getUint32(28, true)).toBe(32000);
    expect(dv.getUint16(34, true)).toBe(16);
    expect(dv.getUint32(40, true)).toBe(10);
    expect(bytes.length).toBe(44 + 10);
  });

  it("test_wav_sample_values_clamped", () => {
    const bytes = encodeWav16(new Float32Array([0, 0.5, -0.5, 2, -2]));
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const s = (i: number) => dv.getInt16(44 + i * 2, true);
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(16384);
    expect(s(2)).toBe(-16384);
    expect(s(3)).toBe(32767);
    expect(s(4)).toBe(-32768);
  });

  it("test_resample_length_48k_and_44k", () => {
    expect(resampleTo16k(sine(440, 48000, 1), 48000).length).toBe(16000);
    expect(resampleTo16k(sine(440, 44100, 1), 44100).length).toBe(16000);
  });

  it("test_resample_same_rate_is_copy", () => {
    const x = sine(440, 16000, 0.1);
    expect(Array.from(resampleTo16k(x, 16000))).toEqual(Array.from(x));
  });

  it("test_resample_keeps_tone", () => {
    const out = resampleTo16k(sine(440, 44100, 0.5), 44100);
    let peak = 0;
    for (let i = 100; i < out.length - 100; i++) peak = Math.max(peak, Math.abs(out[i] ?? 0));
    expect(peak).toBeGreaterThan(0.45);
    expect(peak).toBeLessThan(0.55);
    // zero crossings of 440 Hz over 0.5 s is about 440
    let crossings = 0;
    for (let i = 1; i < out.length; i++) if ((out[i - 1] ?? 0) < 0 !== (out[i] ?? 0) < 0) crossings++;
    expect(crossings).toBeGreaterThan(430);
    expect(crossings).toBeLessThan(450);
  });
});
