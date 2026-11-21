import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Session, Turn } from "../../../shared/types.ts";
import { computeDelivery, countFillers, countWords, DEFAULT_FILLERS } from "./metrics.ts";

const session = JSON.parse(
  readFileSync(new URL("../../../fixtures/transcripts/two-minute.json", import.meta.url), "utf8"),
) as Session;

function turn(partial: Partial<Turn> & Pick<Turn, "role" | "text">): Turn {
  return { index: 0, kind: partial.role === "candidate" ? "answer" : "question", startMs: 0, endMs: 1000, ...partial };
}

describe("delivery metrics", () => {
  // Expected values come from fixtures/transcripts/two-minute.hand-count.md
  it("test_metrics_match_hand_count", () => {
    expect(computeDelivery(session.turns)).toEqual({
      wordsPerMinute: 140,
      fillerCount: 12,
      medianAnswerSec: 20.5,
      longestPauseMs: 3500,
      interruptedCount: 1,
    });
  });

  it("matches the hand count of words and fillers per turn", () => {
    const byTurn = (i: number) => session.turns.find((t) => t.index === i)!.text;
    expect([2, 4, 6, 8].map((i) => countWords(byTurn(i)))).toEqual([60, 43, 54, 37]);
    expect([2, 4, 6, 8].map((i) => countFillers(byTurn(i), DEFAULT_FILLERS))).toEqual([3, 3, 4, 2]);
  });

  it("returns zeros without NaN when there are no candidate turns", () => {
    const d = computeDelivery([turn({ role: "interviewer", text: "Hello there.", interrupted: true })]);
    expect(d).toEqual({ wordsPerMinute: 0, fillerCount: 0, medianAnswerSec: 0, longestPauseMs: 0, interruptedCount: 1 });
    expect(computeDelivery([])).toEqual({ wordsPerMinute: 0, fillerCount: 0, medianAnswerSec: 0, longestPauseMs: 0, interruptedCount: 0 });
  });

  it("returns zero words per minute when candidate duration is zero", () => {
    const d = computeDelivery([turn({ role: "candidate", text: "one two three", startMs: 500, endMs: 500 })]);
    expect(d.wordsPerMinute).toBe(0);
  });

  it("does not count like as a verb but counts it when set off by commas", () => {
    expect(countFillers("I like the plan.", DEFAULT_FILLERS)).toBe(0);
    expect(countFillers("It was, like, fine.", DEFAULT_FILLERS)).toBe(1);
    expect(countFillers("Like, I think so.", DEFAULT_FILLERS)).toBe(1);
    expect(countFillers("It was like like fine.", DEFAULT_FILLERS)).toBe(1);
  });

  it("accepts a custom filler list", () => {
    expect(countFillers("Well, um, right.", ["well"])).toBe(1);
    expect(countFillers("Well, um, right.", [])).toBe(0);
    const d = computeDelivery([turn({ role: "candidate", text: "Well, um, right.", endMs: 3000 })], { fillers: ["well", "right"] });
    expect(d.fillerCount).toBe(2);
  });

  it("ignores interviewer text when counting fillers and words", () => {
    const d = computeDelivery([
      turn({ role: "interviewer", text: "um um um uh well", index: 0 }),
      turn({ role: "candidate", text: "ok fine", index: 1, startMs: 2000, endMs: 3000 }),
    ]);
    expect(d.fillerCount).toBe(0);
    expect(d.wordsPerMinute).toBe(120);
  });

  it("measures pause only from interviewer end to the next candidate start", () => {
    const d = computeDelivery([
      turn({ role: "interviewer", text: "a", index: 0, startMs: 0, endMs: 1000 }),
      turn({ role: "interviewer", text: "b", index: 1, startMs: 9000, endMs: 10000 }),
      turn({ role: "candidate", text: "c", index: 2, startMs: 10400, endMs: 12000 }),
    ]);
    expect(d.longestPauseMs).toBe(400);
  });

  it("clamps a negative gap to zero when the candidate speaks over the interviewer", () => {
    const d = computeDelivery([
      turn({ role: "interviewer", text: "a", index: 0, startMs: 0, endMs: 5000 }),
      turn({ role: "candidate", text: "c", index: 1, startMs: 4800, endMs: 6000 }),
    ]);
    expect(d.longestPauseMs).toBe(0);
  });

  it("takes the middle value as the median for an odd number of answers", () => {
    const d = computeDelivery([
      turn({ role: "candidate", text: "a", index: 0, startMs: 0, endMs: 10000 }),
      turn({ role: "candidate", text: "b", index: 1, startMs: 11000, endMs: 14000 }),
      turn({ role: "candidate", text: "c", index: 2, startMs: 15000, endMs: 20000 }),
    ]);
    expect(d.medianAnswerSec).toBe(5);
  });
});
