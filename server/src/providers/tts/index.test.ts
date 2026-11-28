import { describe, expect, it } from "vitest";
import { createTTSProvider } from "../index.ts";

describe("createTTSProvider", () => {
  it("test_tts_provider_from_env", () => {
    expect(createTTSProvider({}).name).toBe("browser");
    expect(createTTSProvider({ TTS_PROVIDER: "fake" }).name).toBe("fake");
    expect(createTTSProvider({ TTS_PROVIDER: "local" }).name).toBe("local");
    expect(() => createTTSProvider({ TTS_PROVIDER: "x" })).toThrow(/TTS_PROVIDER/);
  });
});
