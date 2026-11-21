import type { Logger } from "./log.ts";

export type OutboundHost = { provider: string; host: string };

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** The only hosts the server talks to: the configured provider URLs (AC-16). */
export function outboundHosts(env: Record<string, string | undefined> = process.env): OutboundHost[] {
  const out: OutboundHost[] = [];
  const llm = env.LLM_PROVIDER || "local";
  if (llm === "local") out.push({ provider: "llm", host: hostOf(env.LOCAL_LLM_URL || "http://127.0.0.1:8080/v1") });
  if (llm === "claude") out.push({ provider: "llm", host: "api.anthropic.com" });
  if ((env.STT_PROVIDER || "whisper") === "whisper") {
    out.push({ provider: "stt", host: hostOf(env.WHISPER_URL || "http://127.0.0.1:8942") });
  }
  if (env.TTS_PROVIDER === "local") out.push({ provider: "tts", host: hostOf(env.LOCAL_TTS_URL || "http://127.0.0.1:8943") });
  return out;
}

export function isLocalHost(host: string): boolean {
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host);
}

/** Logs each distinct outbound host once. */
export function logOutboundHosts(env: Record<string, string | undefined>, log: Logger): void {
  const seen = new Set<string>();
  for (const { provider, host } of outboundHosts(env)) {
    if (seen.has(host)) continue;
    seen.add(host);
    log.info(`outbound host: ${host} (${provider})${isLocalHost(host) ? "" : " NOT LOCAL"}`);
  }
  if (seen.size === 0) log.info("outbound hosts: none (providers are fake or run in the browser)");
}
