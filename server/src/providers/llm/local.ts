import { sseData } from "./sse.ts";
import type { ChatMessage, LLMProvider } from "./types.ts";

export type LocalLLMOptions = {
  /** Base URL of an OpenAI-compatible server, for example http://127.0.0.1:8080/v1 */
  url: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  fetchFn?: typeof fetch;
};

/** llama.cpp llama-server (or any OpenAI-compatible server) with streaming chat completions. */
export function createLocalLLM(o: LocalLLMOptions): LLMProvider {
  const base = o.url.replace(/\/+$/, "");
  const doFetch = o.fetchFn ?? fetch;
  return {
    name: "local",
    async *stream(messages: ChatMessage[], opts) {
      const res = await doFetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: o.model || "local",
          messages,
          stream: true,
          max_tokens: o.maxTokens ?? 120,
          temperature: o.temperature ?? 0.6,
          // Gemma and similar models think by default and spend the whole budget on it. Servers that
          // do not know this field ignore it.
          chat_template_kwargs: { enable_thinking: false },
        }),
        signal: opts?.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Local LLM answered ${res.status}`);
      for await (const data of sseData(res.body, opts?.signal)) {
        if (data === "[DONE]") return;
        let json: { choices?: Array<{ delta?: { content?: string | null } }> };
        try {
          json = JSON.parse(data);
        } catch {
          continue;
        }
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) yield piece;
      }
    },
  };
}
