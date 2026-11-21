import { resolve } from "node:path";
import { Hono } from "hono";
import type { Session } from "../../shared/types.ts";
import { bankDir } from "./banks/load.ts";
import { banksRoutes } from "./banks/routes.ts";
import { createProviders, type Providers } from "./providers/index.ts";
import { roomsRoutes } from "./routes/rooms.ts";
import { sessionRoutes } from "./routes/session.ts";
import { createSessionService, type SessionService } from "./session.ts";

export type ProviderNames = { stt: string; llm: string; tts: string };

export function providerNamesFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderNames {
  return {
    stt: env.STT_PROVIDER || "whisper",
    llm: env.LLM_PROVIDER || "local",
    tts: env.TTS_PROVIDER || "browser",
  };
}

export type AppOptions = {
  providers?: Providers;
  sessionsDir?: string;
  roomsDir?: string;
  mediaDir?: string;
  now?: () => number;
  /** The feedback pass plugs in here. Default: nothing. */
  onSessionEnded?: (session: Session) => void | Promise<void>;
  /** Set by createApp so callers (tests, the feedback task) can reach the service. */
  onService?: (service: SessionService) => void;
};

export function createApp(env: NodeJS.ProcessEnv = process.env, opts: AppOptions = {}): Hono {
  const app = new Hono();
  let providers = opts.providers;
  const getProviders = () => (providers ??= createProviders(env));
  const service = createSessionService({
    getProviders,
    sessionsDir: resolve(opts.sessionsDir ?? env.SESSIONS_DIR ?? "./sessions"),
    banksDir: bankDir(env),
    now: opts.now,
    onSessionEnded: opts.onSessionEnded,
  });
  opts.onService?.(service);

  app.get("/api/health", (c) => c.json({ ok: true, providers: providerNamesFromEnv(env) }));
  app.route("/", banksRoutes(env));
  app.route("/", roomsRoutes(env, { roomsDir: opts.roomsDir, mediaDir: opts.mediaDir }));
  app.route("/", sessionRoutes(service, env));
  return app;
}
