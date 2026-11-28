import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { FeedbackReport, Session } from "../../../shared/types.ts";
import { markUnverified, verifyQuotes } from "./verifyQuotes.ts";

const load = <T>(p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8")) as T;
const session = load<Session>("../../../fixtures/transcripts/two-minute.json");
const report = load<FeedbackReport>("../../../fixtures/reports/two-minute.report.json");

function withQuote(turnIndex: number, quote: string): FeedbackReport {
  return {
    ...report,
    perQuestion: [
      { questionId: "q-x", strengths: [{ note: "n", turnIndex, quote }], gaps: [], rubric: { structure: 1, specificity: 1, relevance: 1, concision: 1 } },
    ],
  };
}

describe("verifyQuotes", () => {
  it("test_verify_quotes_accepts_real_quote", () => {
    expect(verifyQuotes(report, session)).toEqual({ ok: true, failures: [] });
  });

  it("test_verify_quotes_rejects_fabricated_quote", () => {
    const edited = structuredClone(report);
    edited.perQuestion[0]!.strengths[0]!.quote = "We moved twenty percent of accounts first, then half, then everyone.";
    const result = verifyQuotes(edited, session);
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual([
      {
        questionId: "q-migration",
        list: "strengths",
        index: 0,
        turnIndex: 2,
        quote: "We moved twenty percent of accounts first, then half, then everyone.",
        reason: "quote_not_found",
      },
    ]);
  });

  it("passes a quote whose whitespace differs from the turn text", () => {
    expect(verifyQuotes(withQuote(2, "  We moved ten   percent\nof accounts first,  "), session).ok).toBe(true);
  });

  it("treats curly and straight quotes as the same", () => {
    const s: Session = { ...session, turns: [{ index: 0, role: "candidate", kind: "answer", text: "It's a \"good\" plan", startMs: 0, endMs: 1000 }] };
    expect(verifyQuotes(withQuote(0, "It’s a “good” plan"), s).ok).toBe(true);
  });

  it("does not fold case", () => {
    const r = verifyQuotes(withQuote(2, "we moved ten percent of accounts first"), session);
    expect(r.failures[0]?.reason).toBe("quote_not_found");
  });

  it("fails a quote that comes from an interviewer turn", () => {
    const r = verifyQuotes(withQuote(3, "What was the hardest part?"), session);
    expect(r.failures[0]?.reason).toBe("not_candidate_turn");
  });

  it("fails when the cited turn does not exist", () => {
    const r = verifyQuotes(withQuote(99, "anything"), session);
    expect(r.failures[0]?.reason).toBe("turn_missing");
  });

  it("fails an empty or whitespace-only quote", () => {
    expect(verifyQuotes(withQuote(2, "   \n "), session).failures[0]?.reason).toBe("empty_quote");
  });

  it("fails a quote that exists in another candidate turn but not the cited one", () => {
    const r = verifyQuotes(withQuote(4, "We moved ten percent of accounts first"), session);
    expect(r.failures[0]?.reason).toBe("quote_not_found");
  });

  it("reports gaps with list and index", () => {
    const edited = structuredClone(report);
    edited.perQuestion[1]!.gaps[0]!.quote = "invented words";
    const f = verifyQuotes(edited, session).failures;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ questionId: "q-strength", list: "gaps", index: 0 });
  });

  it("markUnverified flags only failing notes and leaves the input unchanged", () => {
    const edited = structuredClone(report);
    edited.perQuestion[0]!.strengths[1]!.quote = "invented words";
    const before = structuredClone(edited);
    const marked = markUnverified(edited, verifyQuotes(edited, session).failures);
    expect(edited).toEqual(before);
    expect(marked.perQuestion[0]!.strengths[1]!.unverified).toBe(true);
    expect(marked.perQuestion[0]!.strengths[0]!.unverified).toBeUndefined();
    expect(marked.perQuestion[1]!.gaps[0]!.unverified).toBeUndefined();
  });
});
