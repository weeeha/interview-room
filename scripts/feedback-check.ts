// Real check for task 4.2: run the feedback pass on the two-minute fixture with a real model.
// Run: LLM_PROVIDER=local LOCAL_LLM_URL=http://127.0.0.1:8944/v1 LOCAL_LLM_MODEL=gemma-4-E4B-it-Q8_0.gguf npx tsx scripts/feedback-check.ts
// Prints timing, stages, retries, how many quotes verified, and each note with its quote.
import { readFileSync } from "node:fs";
import type { QuestionBank, Session } from "../shared/types.ts";
import { createFeedbackLLM, runFeedback } from "../server/src/feedback/run.ts";
import { verifyQuotes } from "../server/src/feedback/verifyQuotes.ts";

const session = JSON.parse(readFileSync(new URL("../fixtures/transcripts/two-minute.json", import.meta.url), "utf8")) as Session;
const q = (id: string, text: string, ref?: string) => ({ id, text, referenceAnswer: ref, followUpHints: [], doNotSay: [], tags: [], hasReferenceAnswer: ref !== undefined });
const bank: QuestionBank = {
  id: "sample-bank",
  title: "Sample",
  sourcePath: "none",
  questions: [
    q("q-migration", "Tell me about a project you delivered under a tight deadline.", "State the project, your role, the plan, the result with a number."),
    q("q-strength", "What would you say your biggest strength is, and also what is a weakness?"),
    q("q-growth", "Where do you want to grow next?", "Name a direction, a first step and why it fits the role."),
  ],
};

const base = createFeedbackLLM(process.env);
let calls = 0;
const llm = { name: base.name, stream: (m: Parameters<typeof base.stream>[0], o?: Parameters<typeof base.stream>[1]) => (calls++, base.stream(m, o)) };
const stages: string[] = [];
const t0 = performance.now();
const { report, warnings } = await runFeedback({ session, bank, llm, onStage: (s) => stages.push(s) });
const seconds = (performance.now() - t0) / 1000;
const notes = report.perQuestion.flatMap((p) => [...p.strengths, ...p.gaps]);
const bad = notes.filter((n) => n.unverified).length;
console.log(JSON.stringify({ seconds: Number(seconds.toFixed(1)), modelCalls: calls, retried: stages.includes("retrying"), notes: notes.length, unverified: bad, verifiedAfterRetry: notes.length - bad, finalCheckOk: verifyQuotes(report, session).ok || bad > 0, warnings }, null, 2));
for (const p of report.perQuestion) {
  console.log(`\n== ${p.questionId} rubric ${JSON.stringify(p.rubric)}${p.rewrite ? "\nrewrite: " + p.rewrite : ""}`);
  for (const n of p.strengths) console.log(`  + [turn ${n.turnIndex}]${n.unverified ? " UNVERIFIED" : ""} ${n.note}\n      "${n.quote}"`);
  for (const n of p.gaps) console.log(`  - [turn ${n.turnIndex}]${n.unverified ? " UNVERIFIED" : ""} ${n.note}\n      "${n.quote}"`);
}
console.log(`\nsummary: ${report.summary}\nnextDrill: ${report.nextDrill.join(" | ")}\ndelivery: ${JSON.stringify(report.delivery)}`);
