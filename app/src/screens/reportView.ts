// Pure view logic for the report screen. No React, no DOM, so it is testable in node.
import type { Session, Turn } from "../../../shared/types.ts";
import type { QuestionReport, Report, ReportStage, RubricKey } from "../reportApi.ts";

export const RUBRIC_ORDER: Array<{ key: RubricKey; label: string }> = [
  { key: "structure", label: "Structure" },
  { key: "specificity", label: "Specificity" },
  { key: "relevance", label: "Relevance" },
  { key: "concision", label: "Concision" },
];

/** Text longer than this is collapsed behind "Show more". */
export const COLLAPSE_AT = 240;
export const isLong = (text: string): boolean => text.length > COLLAPSE_AT;

export function stageLabel(stage: ReportStage | undefined): { step: 1 | 2; of: 2; text: string } {
  switch (stage) {
    case "writing":
      return { step: 2, of: 2, text: "reading your answers" };
    case "verifying":
      return { step: 2, of: 2, text: "checking quotes against the transcript" };
    case "retrying":
      return { step: 2, of: 2, text: "fixing a quote that did not match" };
    case "done":
      return { step: 2, of: 2, text: "finishing up" };
    default:
      return { step: 1, of: 2, text: "measuring your delivery" };
  }
}

export function formatSeconds(sec: number): string {
  const rounded = Math.round(sec * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${rounded === 1 ? "second" : "seconds"}`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function deliveryRows(d: Report["delivery"]): Array<{ label: string; value: string }> {
  // A session logged without speech timings has answers of zero length: pace and length are not measured.
  const timed = d.medianAnswerSec > 0;
  return [
    { label: "Speaking pace", value: timed ? `${Math.round(d.wordsPerMinute)} words per minute` : "Not measured" },
    { label: "Filler words", value: plural(d.fillerCount, "time") },
    { label: "Median answer length", value: timed ? formatSeconds(d.medianAnswerSec) : "Not measured" },
    { label: "Longest pause", value: formatSeconds(d.longestPauseMs / 1000) },
    { label: "Interrupted the interviewer", value: plural(d.interruptedCount, "time") },
  ];
}

export const speaker = (t: Pick<Turn, "role">): string => (t.role === "candidate" ? "You" : "Interviewer");

/** File name of the saved audio for a turn, or undefined when none was saved. */
export function audioFile(turn: Turn | undefined): string | undefined {
  const path = turn?.audioPath;
  if (!path) return undefined;
  const name = path.split("/").pop();
  return name && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) ? name : undefined;
}

export function audioUrl(sessionId: string, file: string): string {
  return `/api/session/${encodeURIComponent(sessionId)}/audio/${encodeURIComponent(file)}`;
}

/** The question as it was asked: the first interviewer question turn for that id. */
export function questionText(session: Session, questionId: string, saved?: string): string {
  if (saved?.trim()) return saved.trim();
  const turn = session.turns.find((t) => t.role === "interviewer" && t.questionId === questionId && t.kind === "question") ?? session.turns.find((t) => t.role === "interviewer" && t.questionId === questionId);
  return turn?.text.trim() || "Question text was not saved.";
}

export function sessionMinutes(session: Session): number {
  const last = session.turns[session.turns.length - 1];
  return last ? Math.max(1, Math.round(last.endMs / 60000)) : 0;
}

export function metaLine(session: Session, bankTitle: string | undefined, profileLabel: string): string {
  const date = new Date(session.startedAt);
  const day = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const mins = sessionMinutes(session);
  return [bankTitle, day, mins > 0 ? plural(mins, "minute") : "", `${profileLabel} interviewer`].filter(Boolean).join(". ") + ".";
}

export function nextQuestionIndex(current: number, count: number, key: string): number | undefined {
  if (count === 0) return undefined;
  if (key === "j" || key === "]") return Math.min(count - 1, current + 1);
  if (key === "k" || key === "[") return Math.max(0, current - 1);
  return undefined;
}

/** Markdown for the export button. Built in the browser. */
export function transcriptMarkdown(session: Session, report: Report | undefined, meta: string): string {
  const out: string[] = ["# Session report", "", meta, ""];
  if (report) {
    out.push("## Summary", "", report.summary, "", "Practice feedback on one session. It does not predict a hiring decision.", "");
    out.push("## Delivery", "", ...deliveryRows(report.delivery).map((r) => `- ${r.label}: ${r.value}`), "");
    if (report.perQuestion.length > 0) {
      out.push("## Questions", "");
      for (const q of report.perQuestion) {
        out.push(`### ${questionText(session, q.questionId, q.questionText)}`, "");
        const notes = (title: string, list: QuestionReport["strengths"]) => {
          if (list.length === 0) return;
          out.push(`**${title}**`, "");
          for (const n of list) out.push(`- ${n.note}${n.unverified ? " (quote not matched to the transcript)" : ""}`, `  > ${n.quote} (turn ${n.turnIndex})`);
          out.push("");
        };
        notes("What held up", q.strengths);
        notes("What was vague", q.gaps);
        out.push("**Scores**", "");
        for (const r of RUBRIC_ORDER) out.push(`- ${r.label}: ${q.rubric[r.key]} of 4${q.rubricReasons?.[r.key] ? `. ${q.rubricReasons[r.key]}` : ""}`);
        out.push("");
        if (q.rewrite) out.push("**Suggested rewrite**", "", q.rewrite, "");
      }
    }
    if (report.nextDrill.length > 0) out.push("## Next drill", "", ...report.nextDrill.map((d, i) => `${i + 1}. ${d}`), "");
  }
  out.push("## Transcript", "");
  for (const t of session.turns) out.push(`**${speaker(t)}, turn ${t.index}:** ${t.text.trim() || "(no speech recognised)"}`, "");
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function exportFileName(session: Session): string {
  return `interview-transcript-${session.startedAt.slice(0, 10) || session.id}.md`;
}
