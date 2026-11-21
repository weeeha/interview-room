import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { FixedLines } from "../../interviewer/profiles.ts";

export type TtsCache = {
  pathFor(voiceId: string, text: string): string;
  get(voiceId: string, text: string): Promise<Buffer | null>;
  put(voiceId: string, text: string, wav: Buffer): Promise<void>;
};

/** Content-hash cache: <dir>/<voice>/<sha256 of text>.wav */
export function createTtsCache(dir: string): TtsCache {
  const pathFor = (voiceId: string, text: string) => {
    if (!/^[A-Za-z0-9_-]+$/.test(voiceId)) throw new Error(`Unsafe voice id "${voiceId}"`);
    return join(dir, voiceId, `${createHash("sha256").update(text).digest("hex")}.wav`);
  };
  return {
    pathFor,
    async get(voiceId, text) {
      try {
        return await readFile(pathFor(voiceId, text));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async put(voiceId, text, wav) {
      const file = pathFor(voiceId, text);
      await mkdir(dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, wav);
      await rename(tmp, file);
    },
  };
}

export function fixedLineTexts(lines: FixedLines): string[] {
  return [lines.opening, lines.closing, lines.silencePrompt, lines.offerNext];
}
