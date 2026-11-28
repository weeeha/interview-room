import { resolve } from "node:path";
import { Hono } from "hono";
import type { Session } from "../../shared/types.ts";
import { bankDir } from "./banks/load.ts";
import { banksRoutes } from "./banks/routes.ts";
import { createFakeFeedbackLLM, createFeedbackService, feedbackRoutes } from "./feedback/service.ts";
import type { LLMProvider } from "./providers/llm/types.ts";
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
  /** Extra hook after a session ends (the feedback pass always runs). */
  onSessionEnded?: (session: Session) => void | Promise<void>;
  /** Model for the feedback pass. Default: the real one, or a deterministic fake when providers are injected. */
  feedbackLLM?: () => LLMProvider;
  /** Set by createApp so callers (tests, the feedback task) can reach the service. */
  onService?: (service: SessionService) => void;
};

export function createApp(env: NodeJS.ProcessEnv = process.env, opts: AppOptions = {}): Hono {
  const app = new Hono();
  let providers = opts.providers;
  const getProviders = () => (providers ??= createProviders(env));
  const sessionsDir = resolve(opts.sessionsDir ?? env.SESSIONS_DIR ?? "./sessions");
  const feedback = createFeedbackService({
    sessionsDir,
    banksDir: bankDir(env),
    env,
    getLLM: opts.feedbackLLM ?? (opts.providers ? () => createFakeFeedbackLLM() : undefined),
  });
  const service = createSessionService({
    getProviders,
    sessionsDir,
    banksDir: bankDir(env),
    now: opts.now,
    onSessionEnded: (session) => {
      feedback.onSessionEnded(session);
      return opts.onSessionEnded?.(session);
    },
    reports: feedback,
  });
  opts.onService?.(service);

  app.get("/api/health", (c) => c.json({ ok: true, providers: providerNamesFromEnv(env) }));
  app.route("/", banksRoutes(env));
  app.route("/", roomsRoutes(env, { roomsDir: opts.roomsDir, mediaDir: opts.mediaDir }));
  app.route("/", sessionRoutes(service, env));
  app.route("/", feedbackRoutes(feedback));
  return app;
}
