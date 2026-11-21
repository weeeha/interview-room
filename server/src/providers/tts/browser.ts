import type { TTSProvider } from "./types.ts";

/** The client speaks with speechSynthesis, so the server has no audio to return. */
export function createBrowserTTS(): TTSProvider {
  return { name: "browser", async synthesize() { return null; } };
}
