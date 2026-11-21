import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PROFILES, linesFor } from "../../interviewer/profiles.ts";
import { createTtsCache, fixedLineTexts } from "./cache.ts";
import { createFakeTTS } from "./fake.ts";
import { sineWav, wavDurationMs } from "./wav.ts";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "tts-cache-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("tts cache", () => {
  it("test_cache_miss_then_hit", async () => {
    const cache = createTtsCache(dir);
    expect(await cache.get("af_heart", "Hello there.")).toBeNull();
    const wav = sineWav(300);
    await cache.put("af_heart", "Hello there.", wav);
    const hit = await cache.get("af_heart", "Hello there.");
    expect(hit?.equals(wav)).toBe(true);
  });

  it("test_cache_keyed_by_voice_and_text", async () => {
    const cache = createTtsCache(dir);
    await cache.put("af_heart", "Hello.", sineWav(300));
    expect(await cache.get("am_michael", "Hello.")).toBeNull();
    expect(await cache.get("af_heart", "Hello!")).toBeNull();
  });

  it("test_cache_path_is_voice_dir_and_sha256", () => {
    const cache = createTtsCache(dir);
    const p = cache.pathFor("af_heart", "abc");
    expect(p).toBe(join(dir, "af_heart", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad.wav"));
  });

  it("test_cache_rejects_unsafe_voice_id", () => {
    expect(() => createTtsCache(dir).pathFor("../x", "a")).toThrow();
  });

  it("test_fixed_lines_cover_every_profile", () => {
    const texts = fixedLineTexts(linesFor(PROFILES[0]!));
    expect(texts).toHaveLength(4);
    expect(new Set(texts).size).toBe(4);
  });
});

describe("wav helpers", () => {
  it("test_wav_duration_roundtrip", () => {
    expect(wavDurationMs(sineWav(500))).toBe(500);
    expect(wavDurationMs(Buffer.from("nope"))).toBe(0);
  });

  it("test_fake_tts_is_deterministic", async () => {
    const tts = createFakeTTS();
    const a = await tts.synthesize("one two three", "af_heart");
    const b = await tts.synthesize("one two three", "af_heart");
    expect(a?.wav.equals(b!.wav)).toBe(true);
    expect(wavDurationMs(a!.wav)).toBe(a!.ms);
  });
});
