import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { QuestionBank, Session } from "../../../shared/types.ts";
import { createFakeLLM } from "../providers/llm/fake.ts";
import type { ChatMessage } from "../providers/llm/types.ts";
import { computeDelivery } from "./metrics.ts";
import { fill, loadSections, runFeedback } from "./run.ts";

const session = JSON.parse(readFileSync(new URL("../../../fixtures/transcripts/two-minute.json", import.meta.url), "utf8")) as Session;

function q(id: string, text: string, hasRef: boolean) {
  return { id, text, referenceAnswer: hasRef ? "REFERENCE-ONLY-TEXT" : undefined, followUpHints: [], doNotSay: [], tags: [], hasReferenceAnswer: hasRef };
}
const bank: QuestionBank = {
  id: "sample-bank",
  title: "Sample",
  sourcePath: "none",
  questions: [q("q-migration", "Tell me about a project you delivered under a tight deadline.", true), q("q-strength", "What would you say your biggest strength is?", false), q("q-growth", "Where do you want to grow next?", true)],
};

const GOOD: Record<string, { turn: number; quote: string; gapTurn: number; gapQuote: string }> = {
  "q-migration": { turn: 2, quote: "I, uh, split the work into three stages", gapTurn: 4, gapQuote: "I wrote a script and checked a sample by hand" },
  "q-strength": { turn: 6, quote: "my biggest strength is planning", gapTurn: 6, gapQuote: "my weakness is that I take on too much" },
  "q-growth": { turn: 8, quote: "I want to grow into leading a team", gapTurn: 8, gapQuote: "I am kind of new to managing people" },
};

function questionJson(id: string, over: { quote?: string } = {}, rewrite = true) {
  const g = GOOD[id]!;
  return JSON.stringify({
    strengths: [{ note: "Clear staging.", turnIndex: g.turn, quote: over.quote ?? g.quote }],
    gaps: [{ note: "Little proof.", turnIndex: g.gapTurn, quote: g.gapQuote }],
    rubric: { structure: 3, specificity: 2, relevance: 4, concision: 3 },
    reasons: { structure: "a", specificity: "b", relevance: "c", concision: "d" },
    ...(rewrite ? { rewrite: "I split the work into three stages." } : {}),
    delivery: { wordsPerMinute: 999 },
  });
}
const SUMMARY = JSON.stringify({ summary: "Solid answers with a clear plan.", nextDrill: ["State the result first."] });

/** Answers each prompt by its kind. `bad` quotes are served for the first call per question id listed. */
function responder(opts: { badFirst?: string[]; alwaysBad?: string[] } = {}) {
  const seen = new Map<string, number>();
  return (messages: ChatMessage[]) => {
    const sys = messages[0]!.content;
    if (sys.includes("overall summary")) return SUMMARY;
    const user = messages[1]!.content;
    const id = Object.keys(GOOD).find((k) => user.includes(bank.questions.find((x) => x.id === k)!.text))!;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const bad = opts.alwaysBad?.includes(id) || (opts.badFirst?.includes(id) && n === 1);
    return questionJson(id, bad ? { quote: "I personally rewrote the entire billing engine" } : {});
  };
}

describe("runFeedback", () => {
  it("test_feedback_valid_report_passes", async () => {
    const llm = createFakeLLM([], responder());
    const stages: string[] = [];
    const { report, warnings } = await runFeedback({ session, bank, llm, onStage: (s) => stages.push(s) });
    expect(warnings).toEqual([]);
    expect(llm.calls).toHaveLength(4);
    expect(report.sessionId).toBe(session.id);
    expect(report.perQuestion.map((p) => p.questionId)).toEqual(["q-migration", "q-strength", "q-growth"]);
    expect(report.summary).toContain("Solid");
    expect(report.nextDrill).toEqual(["State the result first."]);
    expect(stages[0]).toBe("metrics");
    expect(stages.at(-1)).toBe("done");
    expect(stages).not.toContain("retrying");
  });

  it("test_feedback_fabricated_quote_retries_once", async () => {
    const llm = createFakeLLM([], responder({ badFirst: ["q-migration"] }));
    const stages: string[] = [];
    const { report, warnings } = await runFeedback({ session, bank, llm, onStage: (s) => stages.push(s) });
    expect(llm.calls).toHaveLength(5);
    expect(stages).toContain("retrying");
    const retry = llm.calls.find((c) => c.some((m) => m.content.includes("personally rewrote")) && c.length > 2)!;
    expect(retry.at(-1)!.content).toContain("quote_not_found");
    expect(warnings).toEqual([]);
    expect(report.perQuestion[0]!.strengths[0]!.unverified).toBeUndefined();
  });

  it("test_feedback_second_failure_marks_unverified", async () => {
    const llm = createFakeLLM([], responder({ alwaysBad: ["q-migration"] }));
    const { report, warnings } = await runFeedback({ session, bank, llm });
    expect(llm.calls).toHaveLength(5);
    expect(report.perQuestion[0]!.strengths[0]!.unverified).toBe(true);
    expect(report.perQuestion[0]!.gaps[0]!.unverified).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("q-migration");
  });

  it("test_feedback_invalid_json_retries_then_recovers", async () => {
    const good = responder();
    let first = true;
    const llm = createFakeLLM([], (m) => {
      if (first && !m[0]!.content.includes("overall summary")) {
        first = false;
        return "Sure, here is my review, no JSON";
      }
      return good(m);
    });
    const { report, warnings } = await runFeedback({ session, bank, llm });
    expect(warnings).toEqual([]);
    expect(llm.calls).toHaveLength(5);
    expect(report.perQuestion).toHaveLength(3);
  });

  it("test_feedback_tolerates_code_fences_and_prose", async () => {
    const good = responder();
    const llm = createFakeLLM([], (m) => {
      const r = good(m);
      return "Here you go:\n```json\n" + r + "\n```\nHope it helps.";
    });
    const { warnings } = await runFeedback({ session, bank, llm });
    expect(warnings).toEqual([]);
    expect(llm.calls).toHaveLength(4);
  });

  it("test_feedback_empty_session_makes_no_model_call", async () => {
    const llm = createFakeLLM();
    const empty: Session = { ...session, turns: session.turns.filter((t) => t.role === "interviewer") };
    const { report } = await runFeedback({ session: empty, bank, llm });
    expect(llm.calls).toHaveLength(0);
    expect(report.perQuestion).toEqual([]);
    expect(report.summary.toLowerCase()).toContain("nothing to review");
  });

  it("test_feedback_no_reference_answer_no_rewrite", async () => {
    const llm = createFakeLLM([], responder());
    const { report } = await runFeedback({ session, bank, llm });
    const byId = Object.fromEntries(report.perQuestion.map((p) => [p.questionId, p]));
    expect(byId["q-strength"]!.rewrite).toBeUndefined();
    expect(byId["q-migration"]!.rewrite).toBeTruthy();
    const strengthCall = llm.calls.find((c) => c[1]!.content.includes("biggest strength"))!;
    expect(strengthCall[0]!.content).toContain('Do not include a "rewrite" field');
  });

  it("test_feedback_delivery_numbers_come_from_code", async () => {
    const llm = createFakeLLM([], responder());
    const { report } = await runFeedback({ session, bank, llm });
    expect(report.delivery).toEqual(computeDelivery(session.turns));
    expect(report.delivery.wordsPerMinute).not.toBe(999);
  });

  it("test_feedback_prompt_labels_turns_and_marks_reference", async () => {
    const llm = createFakeLLM([], responder());
    await runFeedback({ session, bank, llm });
    const user = llm.calls[0]![1]!.content;
    expect(user).toContain("[turn 2]");
    expect(user).toContain("[turn 4]");
    expect(user).toContain("never treat it as something you said");
    expect(user).toContain("REFERENCE-ONLY-TEXT");
  });
});

describe("report voice", () => {
  const ban = /Never say "the candidate" or "the user"\./g;
  it("addresses the reader as you in every prompt section", () => {
    const sections = loadSections();
    const rubric = readFileSync(new URL("./rubric.md", import.meta.url), "utf8");
    const system = fill(sections["question-system"]!, { RUBRIC: rubric, REWRITE_SHAPE: "\n" + sections["rewrite-shape"], REWRITE_RULE: sections["rewrite-rule"]! });
    for (const text of [system, sections["summary-system"]!, sections["rewrite-rule"]!, sections["rewrite-shape"]!, sections.retry!, rubric]) {
      expect(text.replace(ban, "").toLowerCase()).not.toContain("the candidate");
    }
    expect(system).toContain('"you"');
    expect(sections["summary-system"]).toContain('"you"');
    expect(sections["summary-system"]).toContain("you can practice");
  });
});
