import { describe, expect, it } from "vitest";
import type { Session } from "../../../shared/types.ts";
import type { Report } from "../reportApi.ts";
import { audioFile, audioUrl, deliveryRows, formatSeconds, isLong, nextQuestionIndex, questionText, stageLabel, transcriptMarkdown } from "./reportView.ts";

const session: Session = {
  id: "abc123def",
  startedAt: "2026-01-15T10:00:00.000Z",
  roomId: "r",
  bankId: "b",
  profileId: "neutral",
  targetDurationSec: 120,
  providers: { stt: "fake", llm: "fake", tts: "fake" },
  status: "ended",
  turns: [
    { index: 0, role: "interviewer", kind: "question", questionId: "q1", text: "Tell me about a project.", startMs: 0, endMs: 5000, audioPath: "audio/turn-00-s0.wav" },
    { index: 1, role: "candidate", kind: "answer", questionId: "q1", text: "I led a redesign.", startMs: 5000, endMs: 20000, audioPath: "audio/turn-01.wav" },
    { index: 2, role: "candidate", kind: "answer", questionId: "q1", text: "", startMs: 20000, endMs: 30000 },
  ],
};
const report: Report = {
  sessionId: session.id,
  summary: "Clear answer.",
  perQuestion: [{ questionId: "q1", strengths: [{ note: "Opened with the work.", turnIndex: 1, quote: "I led a redesign." }], gaps: [{ note: "No result.", turnIndex: 1, quote: "I led", unverified: true }], rubric: { structure: 3, specificity: 2, relevance: 4, concision: 3 }, rubricReasons: { structure: "In order." }, rewrite: "I led a redesign and cut drop-off." }],
  delivery: { wordsPerMinute: 146.4, fillerCount: 1, medianAnswerSec: 74, longestPauseMs: 6200, interruptedCount: 0 },
  nextDrill: ["Say one number."],
};

describe("report view logic", () => {
  it("test_delivery_rows_read_as_sentences", () => {
    expect(deliveryRows(report.delivery).map((r) => r.value)).toEqual(["146 words per minute", "1 time", "74 seconds", "6.2 seconds", "0 times"]);
    expect(formatSeconds(1)).toBe("1 second");
  });
  it("test_audio_urls_only_for_saved_files", () => {
    expect(audioFile(session.turns[1])).toBe("turn-01.wav");
    expect(audioFile(session.turns[2])).toBeUndefined();
    expect(audioFile({ ...session.turns[1]!, audioPath: "audio/a b.wav" })).toBeUndefined();
    expect(audioUrl("abc123def", "turn-01.wav")).toBe("/api/session/abc123def/audio/turn-01.wav");
  });
  it("test_question_text_and_collapse", () => {
    expect(questionText(session, "q1")).toBe("Tell me about a project.");
    expect(questionText(session, "q1", "Saved wording?")).toBe("Saved wording?");
    expect(deliveryRows({ ...report.delivery, medianAnswerSec: 0 })[0]?.value).toBe("Not measured");
    expect(questionText(session, "zz")).toBe("Question text was not saved.");
    expect(isLong("x".repeat(300))).toBe(true);
    expect(isLong("short")).toBe(false);
  });
  it("test_stage_labels_and_key_stepping", () => {
    expect(stageLabel("metrics").step).toBe(1);
    expect(stageLabel("verifying").text).toContain("quotes");
    expect(nextQuestionIndex(-1, 3, "j")).toBe(0);
    expect(nextQuestionIndex(2, 3, "j")).toBe(2);
    expect(nextQuestionIndex(0, 3, "k")).toBe(0);
    expect(nextQuestionIndex(0, 3, "x")).toBeUndefined();
    expect(nextQuestionIndex(0, 0, "j")).toBeUndefined();
  });
  it("test_markdown_export_has_report_and_transcript", () => {
    const md = transcriptMarkdown(session, report, "Meta.");
    expect(md).toContain("## Summary");
    expect(md).toContain("> I led a redesign. (turn 1)");
    expect(md).toContain("quote not matched to the transcript");
    expect(md).toContain("- Structure: 3 of 4. In order.");
    expect(md).toContain("**You, turn 2:** (no speech recognised)");
    expect(md).not.toContain("—");
    const bare = transcriptMarkdown(session, undefined, "Meta.");
    expect(bare).not.toContain("## Summary");
    expect(bare).toContain("## Transcript");
  });
});
