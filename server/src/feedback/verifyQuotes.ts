// Quote verification (AC-14). Each strength and gap cites a turn and a quote. The quote must
// appear in that turn's text and the turn must be a candidate turn.
// Matching is exact after two normalizations only: runs of whitespace collapse to one space and
// the text is trimmed, and curly quotes become straight quotes. Case is not folded.
// Regenerating once on failure is the caller's job (task 4.2).
import type { FeedbackReport, Session } from "../../../shared/types.ts";

export type QuoteFailureReason = "turn_missing" | "not_candidate_turn" | "quote_not_found" | "empty_quote";

export type QuoteFailure = {
  questionId: string;
  list: "strengths" | "gaps";
  index: number;
  turnIndex: number;
  quote: string;
  reason: QuoteFailureReason;
};

export type VerifyResult = { ok: boolean; failures: QuoteFailure[] };

type PerQuestion = FeedbackReport["perQuestion"][number];
type Note = PerQuestion["strengths"][number];

// A note that may carry the unverified warning. The shared type is not changed.
export type MarkedNote = Note & { unverified?: boolean };
export type MarkedReport = Omit<FeedbackReport, "perQuestion"> & {
  perQuestion: Array<Omit<PerQuestion, "strengths" | "gaps"> & { strengths: MarkedNote[]; gaps: MarkedNote[] }>;
};

function normalize(text: string): string {
  return text
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function verifyQuotes(report: FeedbackReport, session: Session): VerifyResult {
  const failures: QuoteFailure[] = [];
  for (const q of report.perQuestion) {
    for (const list of ["strengths", "gaps"] as const) {
      q[list].forEach((note, index) => {
        const fail = (reason: QuoteFailureReason) =>
          failures.push({ questionId: q.questionId, list, index, turnIndex: note.turnIndex, quote: note.quote, reason });
        const quote = normalize(note.quote);
        if (quote === "") return fail("empty_quote");
        const turn = session.turns.find((t) => t.index === note.turnIndex);
        if (!turn) return fail("turn_missing");
        if (turn.role !== "candidate") return fail("not_candidate_turn");
        if (!normalize(turn.text).includes(quote)) return fail("quote_not_found");
      });
    }
  }
  return { ok: failures.length === 0, failures };
}

export function markUnverified(report: FeedbackReport, failures: QuoteFailure[]): MarkedReport {
  const key = (questionId: string, list: string, index: number) => `${questionId}|${list}|${index}`;
  const bad = new Set(failures.map((f) => key(f.questionId, f.list, f.index)));
  const mark = (q: PerQuestion, list: "strengths" | "gaps"): MarkedNote[] =>
    q[list].map((note, index) => (bad.has(key(q.questionId, list, index)) ? { ...note, unverified: true as const } : { ...note }));
  return {
    ...report,
    perQuestion: report.perQuestion.map((q) => ({ ...q, strengths: mark(q, "strengths"), gaps: mark(q, "gaps") })),
  };
}
