import type { TTSProvider } from "./types.ts";
import { sineWav } from "./wav.ts";

/** Deterministic: the tone length depends only on the word count, the pitch only on the voice id. */
export function createFakeTTS(): TTSProvider {
  return {
    name: "fake",
    async synthesize(text, voiceId) {
      const words = text.trim().split(/\s+/).filter(Boolean).length;
      const ms = Math.max(200, words * 120);
      let h = 0;
      for (const ch of voiceId) h = (h * 31 + ch.charCodeAt(0)) % 200;
      return { wav: sineWav(ms, { freq: 300 + h }), ms };
    },
  };
}
