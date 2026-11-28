/** Duration in ms of a PCM WAV buffer, read from its header. Returns 0 if the header is unusable. */
export function wavDurationMs(wav: Buffer): number {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return 0;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    let size = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") {
      // Streaming writers may leave the size at 0 or 0xFFFFFFFF.
      if (size === 0 || size === 0xffffffff || offset + 8 + size > wav.length) size = wav.length - offset - 8;
      return byteRate > 0 ? Math.round((size / byteRate) * 1000) : 0;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
}

/** Mono 16-bit PCM WAV of a sine tone. Deterministic. */
export function sineWav(durationMs: number, opts: { freq?: number; sampleRate?: number; amplitude?: number } = {}): Buffer {
  const sampleRate = opts.sampleRate ?? 22050;
  const freq = opts.freq ?? 440;
  const amp = opts.amplitude ?? 0.3;
  const samples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
  const dataBytes = samples * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples; i++) {
    // Short fade in and out so the tone does not click.
    const edge = Math.min(1, i / 200, (samples - 1 - i) / 200);
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * amp * edge * 32767), 44 + i * 2);
  }
  return buf;
}
