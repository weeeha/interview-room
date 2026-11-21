// Usage: npx tsx scripts/stt-check.ts <file.wav>. Sends one WAV through the whisper provider.
import { readFile } from "node:fs/promises";
import { createWhisperSTT } from "../server/src/providers/stt/whisper.ts";

const file = process.argv[2];
if (!file) throw new Error("Pass a WAV path.");
const stt = createWhisperSTT({ url: process.env.WHISPER_URL || "http://127.0.0.1:8942" });
for (let run = 1; run <= 3; run++) {
  const out = await stt.transcribe(await readFile(file));
  console.log(`run ${run}: ${out.ms} ms`);
  if (run === 1) console.log(out.text);
}
