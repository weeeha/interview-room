import type { STTProvider } from "./types.ts";

export type WhisperOptions = {
  url: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/** Whisper marks silence and noise with tags such as [BLANK_AUDIO] or (music). Remove them. */
export function cleanWhisperText(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:music|noise|silence|applause|laughter|inaudible|blank_audio)[^)]*\)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function createWhisperSTT(opts: WhisperOptions): STTProvider {
  const base = opts.url.replace(/\/+$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return {
    name: "whisper",
    async transcribe(wav: Buffer) {
      const started = Date.now();
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "answer.wav");
      form.append("response_format", "json");
      form.append("temperature", "0");
      let res: Response;
      try {
        res = await doFetch(`${base}/v1/audio/transcriptions`, {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        const reason = err instanceof Error ? (err.cause instanceof Error ? err.cause.message : err.message) : String(err);
        throw new Error(
          `Whisper server is not reachable at ${base} (${reason}). Start it with scripts/whisper-server.sh.`,
          { cause: err },
        );
      }
      if (!res.ok) {
        const body = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`Whisper server returned ${res.status}: ${body}`);
      }
      const json = (await res.json()) as { text?: unknown };
      if (typeof json.text !== "string") throw new Error("Whisper server reply has no text field.");
      return { text: cleanWhisperText(json.text), ms: Date.now() - started };
    },
  };
}
