import { sseData } from "./sse.ts";
import type { ChatMessage, LLMProvider } from "./types.ts";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export type ClaudeLLMOptions = {
  env?: Record<string, string | undefined>;
  maxTokens?: number;
  fetchFn?: typeof fetch;
};

/**
 * Anthropic Messages API with streaming, through plain fetch.
 * Paid: construction throws unless ALLOW_PAID=1 and an API key are present.
 */
export function createClaudeLLM(o: ClaudeLLMOptions = {}): LLMProvider {
  const env = o.env ?? process.env;
  if (env.ALLOW_PAID !== "1") throw new Error("The claude provider is paid. Set ALLOW_PAID=1 to allow it.");
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("The claude provider needs ANTHROPIC_API_KEY.");
  const model = env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
  const doFetch = o.fetchFn ?? fetch;
  return {
    name: "claude",
    async *stream(messages: ChatMessage[], opts) {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
      for (const m of messages) {
        if (m.role === "system") continue;
        const last = turns[turns.length - 1];
        if (last && last.role === m.role) last.content += `\n\n${m.content}`;
        else turns.push({ role: m.role, content: m.content });
      }
      const res = await doFetch(API_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": API_VERSION },
        body: JSON.stringify({
          model,
          max_tokens: o.maxTokens ?? 200,
          ...(system ? { system } : {}),
          messages: turns,
          stream: true,
        }),
        signal: opts?.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Claude API answered ${res.status}`);
      for await (const data of sseData(res.body, opts?.signal)) {
        let ev: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } };
        try {
          ev = JSON.parse(data);
        } catch {
          continue;
        }
        if (ev.type === "error") throw new Error(`Claude API error: ${ev.error?.message ?? "unknown"}`);
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) yield ev.delta.text;
        if (ev.type === "message_stop") return;
      }
    },
  };
}
