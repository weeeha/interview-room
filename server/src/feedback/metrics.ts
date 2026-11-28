// Delivery metrics over a session log. Pure functions, no I/O.
//
// Definitions (the hand count in fixtures/transcripts/two-minute.hand-count.md uses the same ones):
// - wordsPerMinute: candidate words divided by candidate speaking minutes, rounded to the
//   nearest integer. Speaking time is the sum of (endMs - startMs) over candidate turns.
//   A word is any run of non-space characters.
// - fillerCount: filler matches over candidate turns only. The list is configurable. Matching is
//   on whole words, ignoring case and surrounding punctuation. "like" cannot be told apart from
//   the verb by looking at words, so it counts only when it is set off by commas (its token ends
//   with a comma and the token before it ends with a comma, or it opens the turn) or when it is
//   immediately repeated ("like like").
// - medianAnswerSec: median candidate turn duration in seconds, rounded to one decimal.
// - longestPauseMs: longest gap from the end of an interviewer turn to the start of the next
//   candidate turn. Interviewer turns followed by another interviewer turn are not pauses.
//   A negative gap (candidate spoke over the interviewer) counts as zero.
// - interruptedCount: interviewer turns with interrupted true.
import type { FeedbackReport, Turn } from "../../../shared/types.ts";

export type DeliveryMetrics = FeedbackReport["delivery"];

export const DEFAULT_FILLERS: readonly string[] = [
  "um",
  "uh",
  "er",
  "like",
  "you know",
  "sort of",
  "kind of",
  "basically",
  "actually",
  "I mean",
];

function tokens(text: string): string[] {
  return text.split(/\s+/).filter((t) => t.length > 0);
}

function normalizeWord(token: string): string {
  return token.toLowerCase().replace(/^[^\p{L}\p{N}']+|[^\p{L}\p{N}']+$/gu, "");
}

export function countWords(text: string): number {
  return tokens(text).length;
}

export function countFillers(text: string, fillers: readonly string[] = DEFAULT_FILLERS): number {
  const raw = tokens(text);
  const words = raw.map(normalizeWord);
  const phrases = fillers
    .map((f) => f.toLowerCase().split(/\s+/).filter((w) => w.length > 0))
    .filter((p) => p.length > 0)
    .sort((a, b) => b.length - a.length);

  let count = 0;
  let i = 0;
  while (i < words.length) {
    let consumed = 0;
    for (const phrase of phrases) {
      if (phrase.length === 1 && phrase[0] === "like") {
        if (words[i] !== "like") continue;
        if (words[i + 1] === "like") {
          // "like like" is one filler, however long the run
          let j = i;
          while (words[j + 1] === "like") j++;
          consumed = j - i + 1;
          break;
        }
        const endsWithComma = raw[i]?.endsWith(",") ?? false;
        const before = i === 0 || (raw[i - 1]?.endsWith(",") ?? false);
        if (endsWithComma && before) {
          consumed = 1;
          break;
        }
        continue;
      }
      if (phrase.every((w, k) => words[i + k] === w)) {
        consumed = phrase.length;
        break;
      }
    }
    if (consumed > 0) {
      count++;
      i += consumed;
    } else {
      i++;
    }
  }
  return count;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function computeDelivery(turns: Turn[], opts: { fillers?: readonly string[] } = {}): DeliveryMetrics {
  const fillers = opts.fillers ?? DEFAULT_FILLERS;
  const candidate = turns.filter((t) => t.role === "candidate");

  const words = candidate.reduce((sum, t) => sum + countWords(t.text), 0);
  const speakingMs = candidate.reduce((sum, t) => sum + Math.max(0, t.endMs - t.startMs), 0);
  const wordsPerMinute = speakingMs > 0 ? Math.round((words * 60000) / speakingMs) : 0;

  const fillerCount = candidate.reduce((sum, t) => sum + countFillers(t.text, fillers), 0);

  const medianAnswerSec = Math.round(median(candidate.map((t) => Math.max(0, t.endMs - t.startMs) / 1000)) * 10) / 10;

  let longestPauseMs = 0;
  for (let i = 0; i + 1 < turns.length; i++) {
    const a = turns[i] as Turn;
    const b = turns[i + 1] as Turn;
    if (a.role === "interviewer" && b.role === "candidate") {
      longestPauseMs = Math.max(longestPauseMs, b.startMs - a.endMs);
    }
  }

  const interruptedCount = turns.filter((t) => t.role === "interviewer" && t.interrupted === true).length;

  return { wordsPerMinute, fillerCount, medianAnswerSec, longestPauseMs, interruptedCount };
}
