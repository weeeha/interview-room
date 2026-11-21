import { createClaudeLLM } from "./llm/claude.ts";
import { createFakeLLM } from "./llm/fake.ts";
import { createLocalLLM } from "./llm/local.ts";
import type { LLMProvider } from "./llm/types.ts";

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

export type Providers = {
  llm: LLMProvider;
  // SLOT (later task): stt: STTProvider, built from STT_PROVIDER (whisper | fake)
  // SLOT (later task): tts: TTSProvider, built from TTS_PROVIDER (browser | local | fake)
};

export function createProviders(env: Env = process.env): Providers {
  return { llm: createLLMProvider(env) };
}
