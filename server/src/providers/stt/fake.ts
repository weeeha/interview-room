import type { STTProvider } from "./types.ts";

export type FakeSTT = STTProvider & {
  /** Byte length of every WAV this provider was given, in order. */
  calls: number[];
};

/**
 * Deterministic provider. Replies are used in order; an Error entry makes transcribe() throw.
 * When the script runs out it returns the fallback text.
 */
export function createFakeSTT(script: Array<string | Error> = [], fallback = "This is a fake transcript."): FakeSTT {
  const calls: number[] = [];
  let i = 0;
  return {
    name: "fake",
    calls,
    async transcribe(wav: Buffer) {
      calls.push(wav.length);
      const next = i < script.length ? script[i] : fallback;
      i += 1;
      if (next instanceof Error) throw next;
      return { text: next as string, ms: 1 };
    },
  };
}
