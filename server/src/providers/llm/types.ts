export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export interface LLMProvider {
  name: string;
  stream(messages: ChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string>;
}
