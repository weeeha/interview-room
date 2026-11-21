// AC-10 check: 5 scripted candidate answers, each with one distinctive invented claim, go through
// the real engine and a real LLM. Prints a markdown table for docs/phase-2-notes.md.
// Run: LOCAL_LLM_URL=http://127.0.0.1:8944/v1 npx tsx scripts/followup-check.ts
import type { QuestionBank } from "../shared/types.ts";
import { createEngine } from "../server/src/interviewer/engine.ts";
import { NEUTRAL } from "../server/src/interviewer/profiles.ts";
import { createLLMProvider } from "../server/src/providers/index.ts";
import type { LLMProvider } from "../server/src/providers/llm/types.ts";

const bank: QuestionBank = {
  id: "check",
  title: "Follow-up check",
  sourcePath: "none",
  questions: [
    {
      id: "c1",
      text: "Tell me about a project where the plan changed late.",
      referenceAnswer: "REFERENCE-NOT-FOR-PROMPTS",
      followUpHints: [],
      doNotSay: [],
      tags: [],
      hasReferenceAnswer: true,
    },
    {
      id: "c2",
      text: "Describe a disagreement with a teammate.",
      referenceAnswer: "REFERENCE-NOT-FOR-PROMPTS",
      followUpHints: [],
      doNotSay: [],
      tags: [],
      hasReferenceAnswer: true,
    },
  ],
};

const answers = [
  { claim: "moved the launch date from March to June", text: "We had a booking app for ferry crews, and two weeks before launch I moved the launch date from March to June because the offline sync lost data on the tug boats. I told the harbour managers myself." },
  { claim: "a seventeen-person night shift", text: "I ran the handover for a seventeen-person night shift at a cold storage warehouse. The plan broke when the freezer sensors changed vendors, so we rewrote the checklist in two days." },
  { claim: "paper maps taped to the dashboard", text: "My team built a delivery tool for a bakery chain. When the GPS feed died in the old town, drivers used paper maps taped to the dashboard, so I added a printed route sheet as a backup." },
  { claim: "cut the report from forty pages to six", text: "The client wanted a weekly report. I cut the report from forty pages to six by dropping every chart nobody had opened, and the plan changed because their finance lead left." },
  { claim: "an apprentice named Tomas who found the bug", text: "In a bridge inspection app, an apprentice named Tomas found the bug that broke our photo upload. I paired with him for a day and we shipped the fix before the inspectors arrived." },
];

function timed(llm: LLMProvider, marks: { first?: number; start?: number }): LLMProvider {
  return {
    name: llm.name,
    async *stream(messages, opts) {
      marks.start = performance.now();
      for await (const chunk of llm.stream(messages, opts)) {
        marks.first ??= performance.now();
        yield chunk;
      }
    },
  };
}

const base = createLLMProvider(process.env);
const rows: string[] = [];
for (const [i, a] of answers.entries()) {
  const marks: { first?: number; start?: number } = {};
  let t = 0;
  const engine = createEngine({ bank, profile: NEUTRAL, targetDurationSec: 600, llm: timed(base, marks), now: () => t });
  for await (const s of engine.next({ kind: "start" })) void s;
  t = 40_000;
  const t0 = performance.now();
  const out: string[] = [];
  let kind = "";
  try {
    for await (const s of engine.next({ kind: "answer", text: a.text })) {
      out.push(s.text);
      kind = s.kind;
    }
  } catch (e) {
    out.push(`ERROR ${(e as Error).message}`);
  }
  const total = Math.round(performance.now() - t0);
  const first = marks.first && marks.start ? Math.round(marks.first - marks.start) : -1;
  const followUp = kind === "followup" ? out.join(" ") : `(no follow-up: ${out.join(" ")})`;
  console.log(`#${i + 1} claim="${a.claim}" first_token_ms=${first} total_ms=${total}\n   ${followUp}`);
  rows.push(JSON.stringify({ n: i + 1, claim: a.claim, followUp, firstTokenMs: first, totalMs: total }));
}
console.log("\nJSON\n" + rows.join("\n"));
