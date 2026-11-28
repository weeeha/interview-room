import { describe, expect, it } from "vitest";
import { createLocalLLM } from "./local.ts";

function sse(parts: string[]): Response {
  const body = parts.map((p) => `data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`).join("") + "data: [DONE]\n\n";
  return new Response(body, { headers: { "content-type": "text/event-stream" } });
}

describe("local llm provider", () => {
  it("test_local_llm_asks_llama_server_to_reuse_its_prompt_cache", async () => {
    let sent: Record<string, unknown> = {};
    const llm = createLocalLLM({
      url: "http://127.0.0.1:1/v1",
      fetchFn: (async (_url: unknown, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sse(["Hello", " there."]);
      }) as typeof fetch,
    });
    let out = "";
    for await (const piece of llm.stream([{ role: "user", content: "hi" }])) out += piece;
    expect(out).toBe("Hello there.");
    expect(sent.cache_prompt).toBe(true);
    expect(sent.stream).toBe(true);
    expect(sent.max_tokens).toBe(120);
  });
});
