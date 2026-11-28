import { describe, expect, it } from "vitest";
import { createApp } from "./index.ts";

describe("health route", () => {
  it("test_health_reports_providers", async () => {
    const app = createApp({ STT_PROVIDER: "fake", LLM_PROVIDER: "fake", TTS_PROVIDER: "browser" });
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, providers: { stt: "fake", llm: "fake", tts: "browser" } });
  });

  it("test_health_defaults", async () => {
    const res = await createApp({}).request("/api/health");
    expect(await res.json()).toEqual({ ok: true, providers: { stt: "whisper", llm: "local", tts: "browser" } });
  });
});
