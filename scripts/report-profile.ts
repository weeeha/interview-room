// Time the feedback pass on a saved session without touching its files: model calls, seconds per call, what overlaps.
// Usage: npx tsx --env-file=.env scripts/report-profile.ts <session id> [--concurrency N] [--max-tokens N]
// Prints one line per model call (start offset, seconds, reply characters, finish reason unknown to the stream so not shown),
// the total seconds from start to the report object, quote check result and warnings. Nothing is written to sessions/.
import { readFileSync } from "node:fs";
import { loadBanks } from "../server/src/banks/load.ts";
import { createLocalLLM } from "../server/src/providers/llm/local.ts";
import { createFeedbackLLM, runFeedback } from "../server/src/feedback/run.ts";
import { feedbackConcurrency, withQuestionIds } from "../server/src/feedback/service.ts";
import { verifyQuotes } from "../server/src/feedback/verifyQuotes.ts";
import type { Session } from "../shared/types.ts";

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const id = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
if (!id) throw new Error("Pass a session id.");
const session = JSON.parse(readFileSync(`sessions/${id}/session.json`, "utf8")) as Session;
const bank = loadBanks(process.env.QUESTION_BANK_DIR || "./banks").find((b) => b.id === session.bankId);
if (!bank) throw new Error(`Bank ${session.bankId} not found`);

const env = { ...process.env, ...(opt("concurrency") ? { FEEDBACK_CONCURRENCY: opt("concurrency") } : {}) } as Record<string, string | undefined>;
const maxTokens = opt("max-tokens");
const base =
  maxTokens && (env.LLM_PROVIDER || "local") === "local"
    ? createLocalLLM({ url: env.LOCAL_LLM_URL || "http://127.0.0.1:8080/v1", model: env.LOCAL_LLM_MODEL, maxTokens: Number(maxTokens), temperature: 0.2 })
    : createFeedbackLLM(env);

const t0 = performance.now();
const calls: Array<{ start: number; end: number; chars: number; kind: string }> = [];
const llm = {
  name: base.name,
  async *stream(m: Parameters<typeof base.stream>[0], o?: Parameters<typeof base.stream>[1]) {
    const c = { start: performance.now() - t0, end: 0, chars: 0, kind: (m[0]?.content ?? "").includes("overall summary") ? "summary" : "question" };
    calls.push(c);
    try {
      for await (const piece of base.stream(m, o)) {
        c.chars += piece.length;
        yield piece;
      }
    } finally {
      c.end = performance.now() - t0;
    }
  },
};
const concurrency = feedbackConcurrency(env);
const { report, warnings } = await runFeedback({ session: withQuestionIds(session), bank, llm, concurrency });
const total = (performance.now() - t0) / 1000;
for (const c of calls) console.log(`${c.kind.padEnd(8)} start ${(c.start / 1000).toFixed(1).padStart(5)} s  took ${((c.end - c.start) / 1000).toFixed(1).padStart(5)} s  reply ${c.chars} chars`);
const check = verifyQuotes(report, session);
const notes = report.perQuestion.flatMap((p) => [...p.strengths, ...p.gaps]);
console.log(JSON.stringify({ session: id, concurrency, total: Number(total.toFixed(1)), calls: calls.length, questions: report.perQuestion.length, notes: notes.length, unverified: notes.filter((n) => n.unverified).length, quoteCheckOk: check.ok, warnings }));
