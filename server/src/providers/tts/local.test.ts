import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTtsCache } from "./cache.ts";
import { createLocalTTS } from "./local.ts";
import { sineWav } from "./wav.ts";

function fakeFetch(wav: Buffer, status = 200) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(status === 200 ? new Uint8Array(wav) : "boom", { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("local tts", () => {
  it("test_local_posts_text_and_voice", async () => {
    const f = fakeFetch(sineWav(400));
    const tts = createLocalTTS({ url: "http://x:1/", fetchImpl: f.impl });
    const out = await tts.synthesize("Hello.", "af_heart");
    expect(f.calls).toEqual([{ url: "http://x:1/tts", body: { text: "Hello.", voice: "af_heart" } }]);
    expect(out?.ms).toBe(400);
  });

  it("test_local_uses_cache_before_network", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tts-local-"));
    try {
      const cache = createTtsCache(dir);
      await cache.put("af_heart", "Hello.", sineWav(250));
      const f = fakeFetch(sineWav(400));
      const out = await createLocalTTS({ url: "http://x:1", cache, fetchImpl: f.impl }).synthesize("Hello.", "af_heart");
      expect(f.calls).toHaveLength(0);
      expect(out?.ms).toBe(250);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("test_local_throws_on_server_error", async () => {
    const tts = createLocalTTS({ url: "http://x:1", fetchImpl: fakeFetch(Buffer.alloc(0), 500).impl });
    await expect(tts.synthesize("Hi.", "af_heart")).rejects.toThrow(/500/);
  });
});
