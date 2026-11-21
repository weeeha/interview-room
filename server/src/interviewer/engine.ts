import { readFileSync } from "node:fs";
import type { InterviewerProfile, Question, QuestionBank, Turn } from "../../../shared/types.ts";
import type { ChatMessage, LLMProvider } from "../providers/llm/types.ts";
import { linesFor } from "./profiles.ts";
import { SentenceSplitter, splitSentences } from "./sentences.ts";

export type EngineEvent =
  | { kind: "start" }
  | { kind: "answer"; text: string }
  | { kind: "silence_prompt" }
  | { kind: "silence_offer_next" };

export type EngineSentence = { text: string; kind: Turn["kind"]; questionId?: string };

export type EngineOptions = {
  bank: QuestionBank;
  profile: InterviewerProfile;
  targetDurationSec: number;
  roleContext?: string;
  llm: LLMProvider;
  /** Milliseconds since the session started. */
  now: () => number;
};

export type Engine = {
  next(event: EngineEvent, o?: { signal?: AbortSignal }): AsyncIterable<EngineSentence>;
  /** What was actually spoken in the last next() call, so the LLM sees the real transcript. */
  commit(spokenText: string, interrupted?: boolean): void;
  state(): object;
  restore(state: object): void;
  isClosed(): boolean;
};

/** The closing line is delivered at a turn boundary once this much of the target is left. */
export const CLOSING_LEAD_SEC = 60;
/** Reply token the model uses when no follow-up is needed. */
export const NEXT_TOKEN = "[NEXT]";
/** At most this many sentences are spoken for one follow-up. */
export const MAX_FOLLOWUP_SENTENCES = 2;
/** Fewer than this many questions would not fit a session, so pacing assumes at least this many. */
export const MIN_QUESTIONS_PER_SESSION = 4;
const TRANSCRIPT_WINDOW = 12;

type Entry = { role: "interviewer" | "candidate"; text: string; kind?: Turn["kind"]; interrupted?: boolean };

type EngineState = {
  version: 1;
  started: boolean;
  closed: boolean;
  usedIds: string[];
  currentId: string | null;
  followUps: number;
  hintIdx: number;
  questionStartMs: number;
  transcript: Entry[];
  lastTurnStart: number;
};

const PROMPT_TEMPLATE = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");

export function buildSystemPrompt(a: { profile: InterviewerProfile; question: Question; roleContext?: string }): string {
  const setup = a.roleContext?.trim()
    ? `Setup notes from the candidate (the only facts you may rely on):\n${a.roleContext.trim()}\n\n`
    : "";
  const dns = a.question.doNotSay.filter((l) => l.trim());
  const doNotSay = dns.length
    ? `You must never say, quote, or hint at any of these lines:\n${dns.map((l) => `- ${l.trim()}`).join("\n")}\n`
    : "";
  return PROMPT_TEMPLATE.replace("{{persona}}", a.profile.persona)
    .replace("{{question}}", a.question.text)
    .replace("{{setup}}", setup)
    .replace("{{doNotSay}}", doNotSay)
    .trim();
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Speech rules the prompt asks for, enforced again on the output. */
function sanitize(sentence: string): string {
  return sentence.replace(/!/g, ".").replace(/[—–]/g, ", ").replace(/\s+/g, " ").trim();
}

export function createEngine(opts: EngineOptions): Engine {
  const { bank, profile, llm, now } = opts;
  const lines = linesFor(profile);
  const byId = new Map(bank.questions.map((qn) => [qn.id, qn]));
  const closeAtMs = Math.max(0, opts.targetDurationSec - CLOSING_LEAD_SEC) * 1000;
  // Time one question may take before follow-ups stop, so the bank questions fit the session.
  const questionBudgetMs = closeAtMs / MIN_QUESTIONS_PER_SESSION;

  let st: EngineState = fresh();

  function fresh(): EngineState {
    return {
      version: 1,
      started: false,
      closed: false,
      usedIds: [],
      currentId: null,
      followUps: 0,
      hintIdx: 0,
      questionStartMs: 0,
      transcript: [],
      lastTurnStart: 0,
    };
  }

  const current = (): Question | undefined => (st.currentId ? byId.get(st.currentId) : undefined);

  function say(text: string, kind: Turn["kind"], questionId?: string): EngineSentence {
    st.transcript.push({ role: "interviewer", text, kind });
    return questionId ? { text, kind, questionId } : { text, kind };
  }

  function timeUp(): boolean {
    return now() >= closeAtMs;
  }

  function pickNext(): Question | undefined {
    const used = new Set(st.usedIds);
    const counts = new Map<string, number>();
    for (const id of st.usedIds) for (const tag of byId.get(id)?.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    let best: Question | undefined;
    let bestScore = Infinity;
    for (const qn of bank.questions) {
      if (used.has(qn.id)) continue;
      const score = qn.tags.length ? qn.tags.reduce((n, t) => n + (counts.get(t) ?? 0), 0) / qn.tags.length : 0;
      if (score < bestScore) {
        best = qn;
        bestScore = score;
      }
    }
    return best;
  }

  async function* closing(): AsyncGenerator<EngineSentence> {
    st.closed = true;
    for (const s of splitSentences(lines.closing)) yield say(s, "closing");
  }

  /** Move to the next bank question, or close when time is up or the bank is empty. */
  async function* askNext(): AsyncGenerator<EngineSentence> {
    const qn = timeUp() ? undefined : pickNext();
    if (!qn) {
      yield* closing();
      return;
    }
    st.usedIds.push(qn.id);
    st.currentId = qn.id;
    st.followUps = 0;
    st.hintIdx = 0;
    st.questionStartMs = now();
    yield say(qn.text, "question", qn.id);
  }

  function renderUserMessage(remaining: number): string {
    const recent = st.transcript.slice(-TRANSCRIPT_WINDOW);
    const rendered: string[] = [];
    let prev: Entry["role"] | null = null;
    for (const e of recent) {
      const label = e.role === "interviewer" ? "Interviewer" : "Candidate";
      if (prev === e.role && rendered.length) rendered[rendered.length - 1] += ` ${oneLine(e.text)}`;
      else rendered.push(`${label}: ${oneLine(e.text)}`);
      prev = e.role;
    }
    return [
      "Conversation so far:",
      rendered.join("\n"),
      "",
      `The candidate has just finished answering. You may ask up to ${remaining} more follow-up question(s) on this topic.`,
      "Reply with one short follow-up in one or two sentences. It must quote or paraphrase a specific thing the candidate just said.",
      `If the answer was already complete and specific, reply with exactly ${NEXT_TOKEN} and nothing else.`,
      "Say only the words to be spoken aloud.",
    ].join("\n");
  }

  /** Streams a follow-up from the LLM. `res.skip` is set when the model asked to move on. */
  async function* llmFollowUp(qn: Question, signal: AbortSignal | undefined, res: { spoke: number; skip: boolean }) {
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt({ profile, question: qn, roleContext: opts.roleContext }) },
      { role: "user", content: renderUserMessage(profile.maxFollowUpsPerQuestion - st.followUps) },
    ];
    const splitter = new SentenceSplitter();
    let head = "";
    let decided = false;
    const emit = function* (parts: string[]): Generator<EngineSentence> {
      for (const raw of parts) {
        const text = sanitize(raw);
        if (!text || res.spoke >= MAX_FOLLOWUP_SENTENCES) continue;
        res.spoke += 1;
        yield say(text, "followup", qn.id);
      }
    };
    const feed = function* (chunk: string): Generator<EngineSentence> {
      if (!decided) {
        head += chunk;
        if (head.trimStart().length < NEXT_TOKEN.length && !/\n/.test(head)) return;
        decided = true;
        if (head.trimStart().startsWith(NEXT_TOKEN)) {
          res.skip = true;
          return;
        }
        chunk = head;
      }
      yield* emit(splitter.push(chunk));
    };
    for await (const chunk of llm.stream(messages, { signal })) {
      if (signal?.aborted) return;
      yield* feed(chunk);
      if (res.skip || res.spoke >= MAX_FOLLOWUP_SENTENCES) return;
    }
    if (signal?.aborted) return;
    if (!decided) {
      decided = true;
      if (head.trimStart().startsWith(NEXT_TOKEN)) {
        res.skip = true;
        return;
      }
      yield* emit(splitter.push(head));
    }
    yield* emit(splitter.flush());
  }

  async function* answer(text: string, signal?: AbortSignal): AsyncGenerator<EngineSentence> {
    st.transcript.push({ role: "candidate", text: oneLine(text), kind: "answer" });
    const qn = current();
    if (!qn) {
      yield* askNext();
      return;
    }
    if (timeUp()) {
      yield* closing();
      return;
    }
    const withinBudget = now() - st.questionStartMs < questionBudgetMs;
    if (st.followUps < profile.maxFollowUpsPerQuestion && withinBudget) {
      const res = { spoke: 0, skip: false };
      try {
        for await (const s of llmFollowUp(qn, signal, res)) yield s;
      } catch {
        // fall through to the hint or the next question
      }
      if (signal?.aborted) return;
      if (res.spoke > 0) {
        st.followUps += 1;
        return;
      }
      if (!res.skip) {
        // The model failed or said nothing: use the bank's own hint, if any is left.
        const hint = qn.followUpHints[st.hintIdx]?.trim();
        if (hint) {
          st.hintIdx += 1;
          st.followUps += 1;
          for (const s of splitSentences(hint)) yield say(sanitize(s), "followup", qn.id);
          return;
        }
      }
    }
    yield* askNext();
  }

  async function* run(event: EngineEvent, signal?: AbortSignal): AsyncGenerator<EngineSentence> {
    if (st.closed || signal?.aborted) return;
    st.lastTurnStart = st.transcript.length;
    switch (event.kind) {
      case "start":
        if (st.started) return;
        st.started = true;
        for (const s of splitSentences(lines.opening)) yield say(s, "opening");
        yield* askNext();
        return;
      case "answer":
        st.started = true;
        yield* answer(event.text, signal);
        return;
      case "silence_prompt":
        for (const s of splitSentences(lines.silencePrompt)) yield say(s, "prompt");
        return;
      case "silence_offer_next":
        for (const s of splitSentences(lines.offerNext)) yield say(s, "prompt");
        yield* askNext();
        return;
    }
  }

  return {
    next: (event, o) => run(event, o?.signal),
    commit(spokenText, interrupted) {
      const text = oneLine(spokenText);
      const kept = st.transcript.slice(0, st.lastTurnStart);
      const last = st.transcript[st.transcript.length - 1];
      if (st.transcript.length > st.lastTurnStart && last?.role === "interviewer") {
        st.transcript = kept;
        if (text) st.transcript.push({ role: "interviewer", text, kind: last.kind, ...(interrupted ? { interrupted: true } : {}) });
      }
    },
    state: () => JSON.parse(JSON.stringify(st)) as EngineState,
    restore(state) {
      const s = state as Partial<EngineState>;
      if (s.version !== 1 || !Array.isArray(s.usedIds) || !Array.isArray(s.transcript)) throw new Error("Unusable engine state");
      st = { ...fresh(), ...(JSON.parse(JSON.stringify(s)) as EngineState) };
    },
    isClosed: () => st.closed,
  };
}
