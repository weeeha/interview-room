import type { TtsCache } from "./cache.ts";
import type { TTSProvider } from "./types.ts";
import { wavDurationMs } from "./wav.ts";

export type LocalTTSOptions = {
  url: string;
  cache?: TtsCache;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

/** Kokoro-82M behind scripts/kokoro_server.py. The cache is checked first for any text. */
export function createLocalTTS(opts: LocalTTSOptions): TTSProvider {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "local",
    async synthesize(text, voiceId) {
      const cached = await opts.cache?.get(voiceId, text);
      if (cached) return { wav: cached, ms: wavDurationMs(cached) };
      const res = await doFetch(`${base}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, voice: voiceId }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
      });
      if (!res.ok) throw new Error(`Local TTS answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const wav = Buffer.from(await res.arrayBuffer());
      return { wav, ms: wavDurationMs(wav) };
    },
  };
}
