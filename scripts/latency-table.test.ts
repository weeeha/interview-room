import { describe, expect, it } from "vitest";
import type { Session, Turn } from "../shared/types.ts";
import { buildTable, median, percentile } from "./latency-table.ts";

function iv(index: number, latency: Partial<NonNullable<Turn["latency"]>>, extra: Partial<Turn> = {}): Turn {
  return { index, role: "interviewer", kind: "followup", text: "x", startMs: 0, endMs: 1000, latency: latency as Turn["latency"], ...extra };
}
const base = (turns: Turn[]): Session => ({
  id: "abc123",
  startedAt: "2026-01-01T00:00:00Z",
  roomId: "r",
  bankId: "b",
  profileId: "neutral",
  targetDurationSec: 600,
  providers: { stt: "fake", llm: "fake", tts: "fake" },
  status: "ended",
  turns,
});

describe("latency table", () => {
  it("computes median and nearest-rank p95", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19);
    expect(median([])).toBeUndefined();
  });

  it("prints medians and p95 of the gap", () => {
    const t = buildTable(base([iv(0, { gapMs: 1000 }), iv(2, { gapMs: 2000, sttMs: 600, llmFirstTokenMs: 300, ttsFirstAudioMs: 500 }), iv(4, { gapMs: 3000 })]));
    expect(t).toContain("gapMs: n=3 median=2000 p95=3000");
    expect(t).toContain("sttMs: n=1 median=600");
  });

  it("says no gap data when gapMs is absent", () => {
    expect(buildTable(base([iv(0, { llmFirstTokenMs: 0 })]))).toContain("no gap data");
  });

  it("shows how long an interrupted turn kept playing after the candidate started", () => {
    const cand: Turn = { index: 1, role: "candidate", kind: "answer", text: "y", startMs: 9000, endMs: 12000 };
    const t = buildTable(base([iv(0, { gapMs: 500 }, { interrupted: true, endMs: 9300 }), cand]));
    expect(t).toMatch(/yes/);
    expect(t).toMatch(/\s300\s+yes/);
  });
});
