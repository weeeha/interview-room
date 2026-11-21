import { createClaudeLLM } from "./llm/claude.ts";
import { createFakeLLM } from "./llm/fake.ts";
import { createLocalLLM } from "./llm/local.ts";
import type { LLMProvider } from "./llm/types.ts";
import { createBrowserTTS } from "./tts/browser.ts";
import { createTtsCache } from "./tts/cache.ts";
import { createFakeTTS } from "./tts/fake.ts";
import { createLocalTTS } from "./tts/local.ts";
import type { TTSProvider } from "./tts/types.ts";
import { createFakeSTT } from "./stt/fake.ts";
import type { STTProvider } from "./stt/types.ts";
import { createWhisperSTT } from "./stt/whisper.ts";

type Env = Record<string, string | undefined>;

export function createLLMProvider(env: Env = process.env): LLMProvider {
  const name = env.LLM_PROVIDER || "local";
  switch (name) {
    case "fake":
      return createFakeLLM();
    case "local":
      return createLocalLLM({ url: env.LOCAL_LLM_URL || "http://127.0.0.1:8080/v1", model: env.LOCAL_LLM_MODEL });
    case "claude":
      return createClaudeLLM({ env });
    default:
      throw new Error(`Unknown LLM_PROVIDER "${name}". Use local, fake or claude.`);
  }
}

export function createSTTProvider(env: Env = process.env): STTProvider {
  const name = env.STT_PROVIDER || "whisper";
  switch (name) {
    case "fake":
      return createFakeSTT();
    case "whisper":
      return createWhisperSTT({ url: env.WHISPER_URL || "http://127.0.0.1:8942" });
    default:
      throw new Error(`Unknown STT_PROVIDER "${name}". Use whisper or fake.`);
  }
}

export function createTTSProvider(env: Env = process.env): TTSProvider {
  const name = env.TTS_PROVIDER || "browser";
  switch (name) {
    case "browser":
      return createBrowserTTS();
    case "fake":
      return createFakeTTS();
    case "local":
      return createLocalTTS({
        url: env.LOCAL_TTS_URL || "http://127.0.0.1:8943",
        cache: createTtsCache(env.TTS_CACHE_DIR || "media/tts-cache"),
      });
    default:
      throw new Error(`Unknown TTS_PROVIDER "${name}". Use browser, local or fake.`);
  }
}

export type Providers = {
  llm: LLMProvider;
  stt: STTProvider;
  tts: TTSProvider;
};

export function createProviders(env: Env = process.env): Providers {
  return { llm: createLLMProvider(env), stt: createSTTProvider(env), tts: createTTSProvider(env) };
}
