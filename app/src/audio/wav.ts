export const TARGET_RATE = 16000;

/** Resample mono float samples to 16 kHz. Downsampling averages the source span of each output sample. */
export function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_RATE) return input.slice();
  const ratio = inputRate / TARGET_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    if (ratio > 1) {
      const from = i * ratio;
      const to = Math.min(input.length, (i + 1) * ratio);
      let sum = 0;
      let weight = 0;
      for (let j = Math.floor(from); j < Math.ceil(to); j++) {
        const w = Math.min(j + 1, to) - Math.max(j, from);
        sum += (input[j] ?? 0) * w;
        weight += w;
      }
      out[i] = weight > 0 ? sum / weight : 0;
    } else {
      const pos = i * ratio;
      const j = Math.floor(pos);
      const frac = pos - j;
      out[i] = (input[j] ?? 0) * (1 - frac) + (input[j + 1] ?? input[j] ?? 0) * frac;
    }
  }
  return out;
}

/** Encode 16 kHz mono float samples (-1 to 1) as a 16-bit PCM WAV file. */
export function encodeWav16(samples: Float32Array, sampleRate = TARGET_RATE): Uint8Array<ArrayBuffer> {
  const dataBytes = samples.length * 2;
  const bytes = new Uint8Array(44 + dataBytes);
  const dv = new DataView(bytes.buffer);
  const tag = (o: number, s: string) => {
    for (let i = 0; i < 4; i++) dv.setUint8(o + i, s.charCodeAt(i));
  };
  tag(0, "RIFF");
  dv.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  tag(36, "data");
  dv.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    dv.setInt16(44 + i * 2, s < 0 ? Math.round(s * 32768) : Math.round(s * 32767), true);
  }
  return bytes;
}
