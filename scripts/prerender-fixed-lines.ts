// Renders every fixed interviewer line (opening, closing, silence prompts) for every profile
// into media/tts-cache/<voice>/<sha256>.wav. Needs the Kokoro server: scripts/kokoro-server.sh
// Run: npx tsx scripts/prerender-fixed-lines.ts
import { PROFILES, linesFor } from "../server/src/interviewer/profiles.ts";
import { createTtsCache, fixedLineTexts } from "../server/src/providers/tts/cache.ts";
import { createLocalTTS } from "../server/src/providers/tts/local.ts";

const url = process.env.LOCAL_TTS_URL || "http://127.0.0.1:8943";
const cache = createTtsCache(process.env.TTS_CACHE_DIR || "media/tts-cache");
const tts = createLocalTTS({ url }); // no cache here: always render fresh

let done = 0;
for (const profile of PROFILES) {
  for (const text of fixedLineTexts(linesFor(profile))) {
    const t0 = performance.now();
    const out = await tts.synthesize(text, profile.voiceId);
    if (!out) throw new Error("Local TTS returned no audio");
    await cache.put(profile.voiceId, text, out.wav);
    done++;
    console.log(`${profile.id} ${profile.voiceId} ${Math.round(performance.now() - t0)} ms render, ${out.ms} ms audio: ${text}`);
  }
}
console.log(`Rendered ${done} lines into ${process.env.TTS_CACHE_DIR || "media/tts-cache"}`);
