// Feedback run (task 4.2). One model call per question, one for the summary. Delivery numbers
// come from code. Every quote is checked by verifyQuotes; a failure gets one regeneration.
// Why per question: a small local model copies quotes far better from a short transcript
// than from the whole session, and a retry then costs one question, not the whole report.
import { readFileSync } from "node:fs";
import type { FeedbackReport, QuestionBank, Session, Turn } from "../../../shared/types.ts";
import { createLLMProvider } from "../providers/index.ts";
import { createClaudeLLM } from "../providers/llm/claude.ts";
import { createLocalLLM } from "../providers/llm/local.ts";
import type { ChatMessage, LLMProvider } from "../providers/llm/types.ts";
import { computeDelivery } from "./metrics.ts";
import { checkQuestionOutput, checkSummaryOutput, extractJson, RUBRIC_KEYS, type Checked, type QuestionOutput } from "./schema.ts";
import { markUnverified, repairTurnIndexes, verifyQuotes, type QuoteFailure } from "./verifyQuotes.ts";

/**
 * The provider for the feedback pass. The default local provider caps replies at 120 tokens, which
 * cuts the JSON off mid-way, so the local model gets a larger budget and a low temperature here.
 */
export function createFeedbackLLM(env: Record<string, string | undefined> = process.env): LLMProvider {
  if ((env.LLM_PROVIDER || "local") === "local") {
    return createLocalLLM({ url: env.LOCAL_LLM_URL || "http://127.0.0.1:8080/v1", model: env.LOCAL_LLM_MODEL, maxTokens: 1500, temperature: 0.2 });
  }
  if (env.LLM_PROVIDER === "claude") return createClaudeLLM({ env, maxTokens: 2000 }); // still refuses without ALLOW_PAID=1
  return createLLMProvider(env);
}

/** Runs `fn` over `items` with at most `limit` in flight and returns the results in the order of `items`. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type FeedbackStage = "metrics" | "writing" | "verifying" | "retrying" | "done";
type PerQuestion = FeedbackReport["perQuestion"][number];

export function loadSections(): Record<string, string> {
  const text = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");
  const out: Record<string, string> = {};
  for (const part of text.split(/^<!-- section: (.+?) -->\n/m).slice(1).reduce<string[][]>((acc, v, i, a) => (i % 2 === 0 ? [...acc, [v, a[i + 1] ?? ""]] : acc), [])) {
    out[part[0]!] = part[1]!.trim();
  }
  return out;
}
export const fill = (t: string, vars: Record<string, string>) => t.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");

async function collect(llm: LLMProvider, messages: ChatMessage[]): Promise<string> {
  let out = "";
  for await (const piece of llm.stream(messages)) out += piece;
  return out;
}

type Group = { questionId: string; text: string; turns: Turn[]; candidateTurns: Turn[] };

function groupTurns(session: Session, bank: QuestionBank): Group[] {
  const groups = new Map<string, Group>();
  for (const t of [...session.turns].sort((a, b) => a.index - b.index)) {
    if (!t.questionId) continue;
    let g = groups.get(t.questionId);
    if (!g) {
      const text = bank.questions.find((x) => x.id === t.questionId)?.text ?? "(question text not in the bank)";
      g = { questionId: t.questionId, text, turns: [], candidateTurns: [] };
      groups.set(t.questionId, g);
    }
    g.turns.push(t);
    if (t.role === "candidate" && t.text.trim() !== "") g.candidateTurns.push(t);
  }
  return [...groups.values()].filter((g) => g.candidateTurns.length > 0);
}

function renderTurns(g: Group): string {
  return g.turns.map((t) => (t.role === "candidate" ? `[turn ${t.index}] Candidate: ${t.text}` : `Interviewer: ${t.text}`)).join("\n");
}

function describeFailures(failures: QuoteFailure[]): string {
  return failures.map((f) => `- ${f.list}[${f.index}] cited turn ${f.turnIndex}, quote "${f.quote}": ${f.reason}`).join("\n");
}

export async function runFeedback(args: {
  session: Session;
  bank: QuestionBank;
  llm: LLMProvider;
  onStage?: (stage: FeedbackStage) => void;
  /** How many question calls may be in flight at once. Default 1. The model server needs that many slots. */
  concurrency?: number;
}): Promise<{ report: FeedbackReport; warnings: string[] }> {
  const { session, bank, llm } = args;
  const stage = args.onStage ?? (() => {});
  const warnings: string[] = [];
  stage("metrics");
  const delivery = computeDelivery(session.turns);
  const groups = groupTurns(session, bank);
  if (groups.length === 0) {
    stage("done");
    return { report: { sessionId: session.id, summary: "There was nothing to review: none of your answers were recorded in this session.", perQuestion: [], delivery, nextDrill: [] }, warnings };
  }

  const sections = loadSections();
  const rubric = readFileSync(new URL("./rubric.md", import.meta.url), "utf8").trim();
  let retried = false;
  const retrying = () => {
    if (!retried) stage("retrying");
    retried = true;
  };

  /** Ask once; on any failure ask again with the failures listed; return the last attempt either way. */
  async function ask<T>(messages: ChatMessage[], check: (raw: unknown) => Checked<T>, extra: (value: T) => QuoteFailure[], listFailures: (f: QuoteFailure[]) => string): Promise<{ value?: T; failures: QuoteFailure[]; errors: string[] }> {
    const attempt = async (msgs: ChatMessage[]) => {
      const reply = await collect(llm, msgs);
      let checked: Checked<T>;
      try {
        checked = check(extractJson(reply));
      } catch (e) {
        checked = { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
      }
      if (!checked.ok) return { reply, errors: checked.errors, failures: [] as QuoteFailure[], value: undefined as T | undefined };
      return { reply, errors: [] as string[], failures: extra(checked.value), value: checked.value as T | undefined };
    };
    const first = await attempt(messages);
    if (first.errors.length === 0 && first.failures.length === 0) return first;
    retrying();
    const problems = first.errors.length ? first.errors.map((e) => `- ${e}`).join("\n") : listFailures(first.failures);
    const again: ChatMessage[] = [...messages, { role: "assistant", content: first.reply }, { role: "user", content: fill(sections.retry!, { FAILURES: problems }) }];
    return attempt(again);
  }

  stage("writing");
  // One task per question. They run `concurrency` at a time; the results keep the order of the session,
  // and so do the warnings, so the report does not depend on which reply came back first.
  async function oneQuestion(g: Group): Promise<{ pq: PerQuestion; warnings: string[] }> {
    const own: string[] = [];
    const entry = bank.questions.find((x) => x.id === g.questionId);
    const wantRewrite = entry?.hasReferenceAnswer === true;
    const system = fill(sections["question-system"]!, {
      RUBRIC: rubric,
      TURN_NUMBERS: g.candidateTurns.map((t) => t.index).join(", "),
      REWRITE_SHAPE: wantRewrite ? "\n" + sections["rewrite-shape"] : "",
      REWRITE_RULE: wantRewrite ? sections["rewrite-rule"]! : sections["no-rewrite-rule"]!,
    });
    const reference = entry?.hasReferenceAnswer && entry.referenceAnswer ? fill(sections.reference!, { REFERENCE_TEXT: entry.referenceAnswer }) : "";
    const user = fill(sections["question-user"]!, { QUESTION: g.text, REFERENCE: reference, TURNS: renderTurns(g) });
    const messages: ChatMessage[] = [{ role: "system", content: system }, { role: "user", content: user }];

    const buildReport = (o: QuestionOutput): PerQuestion => ({
      questionId: g.questionId,
      strengths: o.strengths,
      gaps: o.gaps,
      ...(wantRewrite && o.rewrite ? { rewrite: o.rewrite } : {}),
      rubric: o.rubric,
    });
    // Repair first: a wrong turn number alone must not cost a second model call.
    const verify = (o: QuestionOutput): QuoteFailure[] => {
      stage("verifying");
      const fixed = repairTurnIndexes({ sessionId: session.id, summary: "", perQuestion: [buildReport(o)], delivery, nextDrill: [] }, session).perQuestion[0]!;
      o.strengths = fixed.strengths;
      o.gaps = fixed.gaps;
      return verifyQuotes({ sessionId: session.id, summary: "", perQuestion: [buildReport(o)], delivery, nextDrill: [] }, session).failures;
    };
    const res = await ask(messages, (raw) => checkQuestionOutput(raw, { wantRewrite }), verify, describeFailures);
    if (!res.value) {
      own.push(`Question ${g.questionId}: the model did not return usable feedback (${res.errors.join("; ")}). It is left empty.`);
      return { pq: { questionId: g.questionId, strengths: [], gaps: [], rubric: { structure: 1, specificity: 1, relevance: 1, concision: 1 } }, warnings: own };
    }
    let pq = buildReport(res.value);
    if (res.failures.length > 0) {
      pq = markUnverified({ sessionId: session.id, summary: "", perQuestion: [pq], delivery, nextDrill: [] }, res.failures).perQuestion[0]!;
      own.push(`Question ${g.questionId}: ${res.failures.length} quote(s) could not be found in the transcript and are marked unverified.`);
    }
    // rubric reasons are kept beside the scores for the report page
    (pq as PerQuestion & { rubricReasons?: Record<string, string> }).rubricReasons = Object.fromEntries(RUBRIC_KEYS.map((k) => [k, res.value!.reasons[k]]));
    return { pq, warnings: own };
  }

  const results = await mapLimit(groups, Math.max(1, Math.floor(args.concurrency ?? 1)), oneQuestion);
  const perQuestion: PerQuestion[] = results.map((r) => r.pq);
  for (const r of results) warnings.push(...r.warnings);

  const notes = perQuestion
    .map((p) => {
      const text = groups.find((g) => g.questionId === p.questionId)!.text;
      const lines = [`Question: ${text}`, ...p.strengths.map((n) => `Strength: ${n.note}`), ...p.gaps.map((n) => `Gap: ${n.note}`), `Rubric: ${RUBRIC_KEYS.map((k) => `${k} ${p.rubric[k]}`).join(", ")}`];
      return lines.join("\n");
    })
    .join("\n\n");
  const summaryMessages: ChatMessage[] = [
    { role: "system", content: sections["summary-system"]! },
    { role: "user", content: fill(sections["summary-user"]!, { NOTES: notes }) },
  ];
  const sum = await ask(summaryMessages, checkSummaryOutput, () => [], describeFailures);
  let summary: string;
  let nextDrill: string[];
  if (sum.value) {
    summary = sum.value.summary;
    nextDrill = sum.value.nextDrill;
  } else {
    warnings.push(`The overall summary could not be written (${sum.errors.join("; ")}). A short default was used.`);
    summary = `This session covered ${perQuestion.length} question${perQuestion.length === 1 ? "" : "s"}. Read the notes under each question.`;
    nextDrill = perQuestion.flatMap((p) => p.gaps.slice(0, 1).map((n) => n.note)).slice(0, 3);
  }
  stage("done");
  return { report: { sessionId: session.id, summary, perQuestion, delivery, nextDrill }, warnings };
}
