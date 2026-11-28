import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./log.ts";
import { isLocalHost, logOutboundHosts, outboundHosts } from "./network.ts";

describe("outbound hosts (AC-16)", () => {
  it("test_provider_urls_default_to_localhost", () => {
    const hosts = outboundHosts({ LLM_PROVIDER: "local", STT_PROVIDER: "whisper", TTS_PROVIDER: "local" });
    expect(hosts.map((h) => h.provider)).toEqual(["llm", "stt", "tts"]);
    for (const h of hosts) expect(isLocalHost(h.host)).toBe(true);
  });

  it("fake and browser providers make no outbound request", () => {
    expect(outboundHosts({ LLM_PROVIDER: "fake", STT_PROVIDER: "fake", TTS_PROVIDER: "browser" })).toEqual([]);
  });

  it("the claude provider is the only external host", () => {
    const hosts = outboundHosts({ LLM_PROVIDER: "claude", STT_PROVIDER: "fake", TTS_PROVIDER: "fake" });
    expect(hosts).toEqual([{ provider: "llm", host: "api.anthropic.com" }]);
  });

  it("logs each host once", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    logOutboundHosts({ LLM_PROVIDER: "local", STT_PROVIDER: "whisper", TTS_PROVIDER: "local", LOCAL_LLM_URL: "http://127.0.0.1:9/v1", WHISPER_URL: "http://127.0.0.1:9", LOCAL_TTS_URL: "http://127.0.0.1:9" }, createLogger("t"));
    const n = spy.mock.calls.filter((c) => String(c[0]).includes("outbound host")).length;
    spy.mockRestore();
    expect(n).toBe(1);
  });
});
