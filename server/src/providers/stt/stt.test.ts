import { describe, expect, it } from "vitest";
import { createFakeSTT } from "./fake.ts";
import { cleanWhisperText, createWhisperSTT } from "./whisper.ts";

const wav = Buffer.from("RIFFxxxxWAVE");

function stubFetch(body: unknown, status = 200) {
  const seen: { url: string; form?: FormData }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, form: init?.body as FormData });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

describe("whisper provider", () => {
  it("test_whisper_posts_multipart", async () => {
    const { impl, seen } = stubFetch({ text: " Hello there. " });
    const stt = createWhisperSTT({ url: "http://127.0.0.1:8942/", fetchImpl: impl });
    const out = await stt.transcribe(wav);
    expect(out.text).toBe("Hello there.");
    expect(out.ms).toBeGreaterThanOrEqual(0);
    expect(seen[0]?.url).toBe("http://127.0.0.1:8942/v1/audio/transcriptions");
    const file = seen[0]?.form?.get("file") as File;
    expect(file.size).toBe(wav.length);
  });

  it("test_whisper_trims_tags", () => {
    expect(cleanWhisperText("[BLANK_AUDIO]")).toBe("");
    expect(cleanWhisperText(" [ Silence ] I led it. [MUSIC] Then we shipped. ")).toBe("I led it. Then we shipped.");
    expect(cleanWhisperText("(music) hello")).toBe("hello");
  });

  it("test_whisper_unreachable_error", async () => {
    const impl = (async () => {
      throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
    }) as unknown as typeof fetch;
    const stt = createWhisperSTT({ url: "http://127.0.0.1:1", fetchImpl: impl });
    await expect(stt.transcribe(wav)).rejects.toThrow(/not reachable.*ECONNREFUSED.*whisper-server\.sh/);
  });

  it("test_whisper_http_error", async () => {
    const { impl } = stubFetch("boom", 500);
    const stt = createWhisperSTT({ url: "http://x", fetchImpl: impl });
    await expect(stt.transcribe(wav)).rejects.toThrow(/500/);
  });
});

describe("fake stt", () => {
  it("test_fake_stt_script", async () => {
    const stt = createFakeSTT(["one", new Error("bad")], "rest");
    expect((await stt.transcribe(wav)).text).toBe("one");
    await expect(stt.transcribe(wav)).rejects.toThrow("bad");
    expect((await stt.transcribe(wav)).text).toBe("rest");
    expect(stt.calls).toEqual([wav.length, wav.length, wav.length]);
  });
});
