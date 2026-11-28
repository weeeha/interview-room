import type { ChatMessage, LLMProvider } from "./types.ts";

export type FakeReply = string | Error | ((messages: ChatMessage[]) => string);

export type FakeLLM = LLMProvider & {
  /** Every message list this provider was called with, in order. */
  calls: ChatMessage[][];
};

/** Last "Candidate:" line of the transcript the engine renders into its user message. */
export function lastCandidateLine(messages: ChatMessage[]): string {
  const text = messages.map((m) => m.content).join("\n");
  const lines = text.split("\n").filter((l) => l.startsWith("Candidate: "));
  return (lines[lines.length - 1] ?? "").slice("Candidate: ".length).trim();
}

/** Deterministic default reply: quotes the first words of the candidate's last answer. */
export function defaultFakeReply(messages: ChatMessage[]): string {
  const words = lastCandidateLine(messages).split(/\s+/).filter(Boolean).slice(0, 6).join(" ");
  return words ? `You said "${words}". What was the hardest part of that?` : "Can you say a little more about that?";
}

/**
 * Scripted provider. Replies are used in order; an Error entry makes stream() throw.
 * When the script runs out it uses `fallback` (default: a reply that quotes the candidate).
 */
export function createFakeLLM(script: FakeReply[] = [], fallback: FakeReply = defaultFakeReply): FakeLLM {
  const calls: ChatMessage[][] = [];
  let i = 0;
  return {
    name: "fake",
    calls,
    async *stream(messages, opts) {
      calls.push(messages.map((m) => ({ ...m })));
      const entry: FakeReply = script[i] ?? fallback;
      i += 1;
      if (entry instanceof Error) throw entry;
      const text = typeof entry === "function" ? entry(messages) : entry;
      const pieces = text.match(/\S+\s*/g) ?? [];
      for (const piece of pieces) {
        if (opts?.signal?.aborted) return;
        yield piece;
      }
    },
  };
}
