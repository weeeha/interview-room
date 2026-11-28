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
  async function render(text: string, voiceId: string): Promise<Buffer> {
    const res = await doFetch(`${base}/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, voice: voiceId }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20000),
    });
    if (!res.ok) throw new Error(`Local TTS answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const cache = opts.cache;
  const inFlight = new Map<string, Promise<void>>();
  return {
    name: "local",
    async synthesize(text, voiceId) {
      // A line being rendered ahead is awaited instead of rendered twice.
      if (cache) await inFlight.get(cache.pathFor(voiceId, text))?.catch(() => undefined);
      const cached = await cache?.get(voiceId, text);
      if (cached) return { wav: cached, ms: wavDurationMs(cached) };
      const wav = await render(text, voiceId);
      return { wav, ms: wavDurationMs(wav) };
    },
    ...(cache && {
      prepare(text: string, voiceId: string): Promise<void> {
        const key = cache.pathFor(voiceId, text);
        let job = inFlight.get(key);
        if (!job) {
          job = (async () => {
            if (await cache.get(voiceId, text)) return;
            await cache.put(voiceId, text, await render(text, voiceId));
          })().finally(() => inFlight.delete(key));
          inFlight.set(key, job);
        }
        return job;
      },
    }),
  };
}
