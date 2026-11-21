import { Hono } from "hono";
import { banksRoutes } from "./banks/routes.ts";

export type ProviderNames = { stt: string; llm: string; tts: string };

export function providerNamesFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderNames {
  return {
    stt: env.STT_PROVIDER || "whisper",
    llm: env.LLM_PROVIDER || "local",
    tts: env.TTS_PROVIDER || "browser",
  };
}

export function createApp(env: NodeJS.ProcessEnv = process.env): Hono {
  const app = new Hono();
  app.get("/api/health", (c) => c.json({ ok: true, providers: providerNamesFromEnv(env) }));
  app.route("/", banksRoutes(env));
  return app;
}
