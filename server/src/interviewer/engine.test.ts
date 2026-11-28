import { describe, expect, it } from "vitest";
import type { Question, QuestionBank } from "../../../shared/types.ts";
import { createFakeLLM } from "../providers/llm/fake.ts";
import { createLocalLLM } from "../providers/llm/local.ts";
import { createClaudeLLM } from "../providers/llm/claude.ts";
import { createLLMProvider } from "../providers/index.ts";
import {
  buildSystemPrompt,
  createEngine,
  type EngineEvent,
  type EngineSentence,
} from "./engine.ts";
import { NEUTRAL, NEUTRAL_LINES, PROBING, WARM, linesFor } from "./profiles.ts";

function q(n: number, extra: Partial<Question> = {}): Question {
  return {
    id: `q${n}`,
    text: `Question number ${n} about topic ${n}?`,
    referenceAnswer: `SECRET-REFERENCE-${n}`,
    followUpHints: [],
    doNotSay: [],
    tags: [],
    hasReferenceAnswer: true,
    ...extra,
  };
}

function bank(n = 8, mk: (i: number) => Question = (i) => q(i)): QuestionBank {
  return { id: "b", title: "Test bank", sourcePath: "/tmp/none", questions: Array.from({ length: n }, (_, i) => mk(i + 1)) };
}

async function collect(it: AsyncIterable<EngineSentence>): Promise<EngineSentence[]> {
  const out: EngineSentence[] = [];
  for await (const s of it) out.push(s);
  return out;
}

function harness(opts: {
  bank?: QuestionBank;
  target?: number;
  llm?: ReturnType<typeof createFakeLLM>;
  profile?: typeof NEUTRAL;
  roleContext?: string;
}) {
  let t = 0;
  const llm = opts.llm ?? createFakeLLM();
  const engine = createEngine({
    bank: opts.bank ?? bank(),
    profile: opts.profile ?? NEUTRAL,
    targetDurationSec: opts.target ?? 600,
    roleContext: opts.roleContext,
    llm,
    now: () => t,
  });
  const log: EngineSentence[] = [];
  const followupTurns: string[] = [];
  async function send(ev: EngineEvent, advanceSec = 0) {
    t += advanceSec * 1000;
    const out = await collect(engine.next(ev));
    engine.commit(out.map((s) => s.text).join(" "));
    log.push(...out);
    return out;
  }
  return { engine, llm, log, followupTurns, send, clock: () => t };
}

/** Runs a full session where every answer takes `answerSec`; returns the time the closing line was produced. */
async function runSession(h: ReturnType<typeof harness>, answerSec: number) {
  await h.send({ kind: "start" });
  let closedAt = -1;
  h.followupTurns.length = 0;
  for (let i = 0; i < 200 && !h.engine.isClosed(); i++) {
    const out = await h.send({ kind: "answer", text: "I led the migration and it took three weeks." }, answerSec);
    if (out.some((s) => s.kind === "closing")) closedAt = h.clock();
    const fu = out.find((s) => s.kind === "followup");
    if (fu?.questionId) h.followupTurns.push(fu.questionId);
  }
  return closedAt;
}

describe("interviewer engine", () => {
  it("test_no_repeat_questions", async () => {
    const h = harness({ bank: bank(8) });
    await runSession(h, 40);
    const asked = h.log.filter((s) => s.kind === "question").map((s) => s.questionId);
    expect(asked.length).toBeGreaterThanOrEqual(4);
    expect(new Set(asked).size).toBe(asked.length);
    const texts = h.log.filter((s) => s.kind === "question").map((s) => s.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("test_upcoming_question_is_the_one_asked_next", async () => {
    const h = harness({ bank: bank(8) });
    expect(h.engine.upcomingQuestion()).toBe(q(1).text);
    await h.send({ kind: "start" });
    for (let i = 0; i < 40 && !h.engine.isClosed(); i++) {
      const expected = h.engine.upcomingQuestion();
      const out = await h.send({ kind: "answer", text: "I led the migration and it took three weeks." }, 40);
      const asked = out.find((s) => s.kind === "question");
      if (asked) expect(asked.text).toBe(expected);
    }
    expect(h.engine.upcomingQuestion()).toBeUndefined();
  });

  it("test_max_two_followups", async () => {
    const h = harness({ bank: bank(8), target: 3000 });
    await runSession(h, 5);
    const perQuestion = new Map<string, number>();
    for (const id of h.followupTurns) perQuestion.set(id, (perQuestion.get(id) ?? 0) + 1);
    expect(perQuestion.size).toBeGreaterThan(0);
    for (const n of perQuestion.values()) expect(n).toBeLessThanOrEqual(2);
    expect(Math.max(...perQuestion.values())).toBe(2);
  });

  it("test_closes_near_target_time", async () => {
    const h = harness({ bank: bank(20), target: 600 });
    const closedAt = await runSession(h, 45);
    expect(closedAt).toBeGreaterThanOrEqual(540_000);
    expect(closedAt).toBeLessThanOrEqual(660_000);
    expect(h.engine.isClosed()).toBe(true);
    const questions = new Set(h.log.filter((s) => s.kind === "question").map((s) => s.questionId));
    expect(questions.size).toBeGreaterThanOrEqual(4);
  });

  it("test_closes_when_bank_runs_out", async () => {
    const h = harness({ bank: bank(2), target: 6000 });
    await runSession(h, 5);
    expect(h.engine.isClosed()).toBe(true);
    expect(h.log.filter((s) => s.kind === "question")).toHaveLength(2);
  });

  it("test_opening_and_closing_are_fixed_lines", async () => {
    const h = harness({ bank: bank(1), target: 100 });
    const first = await h.send({ kind: "start" });
    expect(first.filter((s) => s.kind === "opening").map((s) => s.text).join(" ")).toBe(NEUTRAL_LINES.opening);
    expect(first.find((s) => s.kind === "question")?.text).toBe("Question number 1 about topic 1?");
    const end = await h.send({ kind: "answer", text: "An answer." }, 90);
    expect(end.map((s) => s.text).join(" ")).toBe(NEUTRAL_LINES.closing);
    expect(linesFor(WARM).opening).not.toBe(linesFor(PROBING).opening);
  });

  it("test_followup_text_comes_from_llm_and_is_capped", async () => {
    const llm = createFakeLLM(['You said "three weeks". Why so fast? And what else? And more?']);
    const h = harness({ llm });
    await h.send({ kind: "start" });
    const out = await h.send({ kind: "answer", text: "It took three weeks." }, 20);
    expect(out.map((s) => s.kind)).toEqual(["followup", "followup"]);
    expect(out[0]?.text).toBe('You said "three weeks".');
    expect(out[0]?.questionId).toBe("q1");
  });

  it("test_next_token_moves_on_without_followup", async () => {
    const h = harness({ llm: createFakeLLM(["[NEXT]"]) });
    await h.send({ kind: "start" });
    const out = await h.send({ kind: "answer", text: "Complete answer." }, 20);
    expect(out.map((s) => s.kind)).toEqual(["question"]);
    expect(out[0]?.questionId).toBe("q2");
  });

  it("test_llm_failure_falls_back_to_hint_then_moves_on", async () => {
    const b = bank(3, (i) => q(i, { followUpHints: i === 1 ? ["What was your own role in that?"] : [] }));
    const h = harness({ bank: b, llm: createFakeLLM([new Error("down"), new Error("down"), ""]) });
    await h.send({ kind: "start" });
    const a1 = await h.send({ kind: "answer", text: "One." }, 10);
    expect(a1.map((s) => [s.kind, s.text])).toEqual([["followup", "What was your own role in that?"]]);
    const a2 = await h.send({ kind: "answer", text: "Two." }, 10); // llm error, no hints left: move on
    expect(a2.map((s) => s.kind)).toEqual(["question"]);
    expect(a2[0]?.questionId).toBe("q2");
    const a3 = await h.send({ kind: "answer", text: "Three." }, 10); // empty llm reply, no hints: move on
    expect(a3.map((s) => s.kind)).toEqual(["question"]);
    expect(a3[0]?.questionId).toBe("q3");
  });

  it("test_system_prompt_never_contains_reference_answer", async () => {
    const b = bank(3, (i) => q(i, { doNotSay: i === 1 ? ["Never mention the layoffs."] : [] }));
    const h = harness({ bank: b, roleContext: "Role: senior designer at an invented studio." });
    await runSession(h, 30);
    expect(h.llm.calls.length).toBeGreaterThan(0);
    for (const call of h.llm.calls) for (const m of call) expect(m.content).not.toContain("SECRET-REFERENCE");
    const first = h.llm.calls[0]?.[0];
    expect(first?.role).toBe("system");
    expect(first?.content).toContain("Never mention the layoffs.");
    expect(first?.content).toContain("Role: senior designer at an invented studio.");
    const direct = buildSystemPrompt({ profile: NEUTRAL, question: q(9) });
    expect(direct).not.toContain("SECRET-REFERENCE");
    expect(direct).not.toContain("{{");
    expect(direct).not.toContain("—");
  });

  it("test_llm_sees_what_was_actually_spoken", async () => {
    const h = harness({});
    await h.send({ kind: "start" });
    h.engine.commit("Question number 1 about", true); // cut off by the candidate
    await h.send({ kind: "answer", text: "I will answer anyway." }, 10);
    const user = h.llm.calls[0]?.find((m) => m.role === "user")?.content ?? "";
    expect(user).toContain("Interviewer: Question number 1 about\n");
    expect(user).not.toContain("topic 1");
    expect(user).toContain("Candidate: I will answer anyway.");
  });

  it("test_silence_prompt_then_offer_next", async () => {
    const h = harness({});
    await h.send({ kind: "start" });
    const p = await h.send({ kind: "silence_prompt" }, 8);
    expect(p).toEqual([{ text: NEUTRAL_LINES.silencePrompt, kind: "prompt" }]);
    expect(h.llm.calls).toHaveLength(0);
    const o = await h.send({ kind: "silence_offer_next" }, 12);
    expect(o).toEqual([{ text: NEUTRAL_LINES.offerNext, kind: "prompt" }]);
    expect(h.llm.calls).toHaveLength(0);
  });

  it("test_offer_is_a_question_in_each_profile", () => {
    for (const lines of [linesFor(WARM), linesFor(NEUTRAL), linesFor(PROBING)]) {
      expect(lines.offerNext.trim().endsWith("?")).toBe(true);
    }
  });

  it("test_offer_agreement_moves_to_next_question", async () => {
    for (const reply of ["Yes.", "yes please", "Sure, move on.", "Okay, next question", "skip it", "Let's move on"]) {
      const h = harness({});
      await h.send({ kind: "start" });
      await h.send({ kind: "silence_offer_next" }, 20);
      const out = await h.send({ kind: "answer", text: reply }, 3);
      expect(out.map((s) => s.kind), reply).toEqual(["question"]);
      expect(out[0]?.questionId).toBe("q2");
      expect(h.llm.calls).toHaveLength(0);
    }
  });

  it("test_offer_other_speech_is_an_answer", async () => {
    for (const reply of [
      "No, I want to answer it.",
      "Yes I led the migration and it took three weeks.",
      "Actually I do have an example from my last role.",
    ]) {
      const h = harness({ llm: createFakeLLM(["Which part did you own yourself?"]) });
      await h.send({ kind: "start" });
      await h.send({ kind: "silence_offer_next" }, 20);
      const out = await h.send({ kind: "answer", text: reply }, 10);
      expect(out.map((s) => s.kind), reply).toEqual(["followup"]);
      expect(h.llm.calls).toHaveLength(1);
    }
  });

  it("test_offer_then_more_silence_moves_on", async () => {
    for (const again of ["silence_offer_next", "silence_prompt"] as const) {
      const h = harness({});
      await h.send({ kind: "start" });
      await h.send({ kind: "silence_offer_next" }, 20);
      const out = await h.send({ kind: "silence_offer_next" }, 12);
      expect(out.map((s) => s.kind)).toEqual(["question"]);
      expect(out[0]?.questionId).toBe("q2");
      // the offer is not repeated: a later silence starts again with the short prompt or a new offer
      const h2 = harness({});
      await h2.send({ kind: "start" });
      await h2.send({ kind: "silence_offer_next" }, 20);
      const out2 = await h2.send({ kind: again }, 8);
      expect(out2.map((s) => s.kind)).toEqual(["question"]);
    }
  });

  it("test_offer_waiting_state_survives_restore", async () => {
    const h = harness({});
    await h.send({ kind: "start" });
    await h.send({ kind: "silence_offer_next" }, 20);
    const saved = h.engine.state();
    expect(JSON.parse(JSON.stringify(saved))).toMatchObject({ awaitingOffer: true });
    const h2 = harness({});
    h2.engine.restore(saved);
    const out = await h2.send({ kind: "answer", text: "yes" }, 2);
    expect(out.map((s) => s.kind)).toEqual(["question"]);
    // a state saved before this field existed restores as not waiting
    const old = { ...(saved as Record<string, unknown>) };
    delete old.awaitingOffer;
    const h3 = harness({ llm: createFakeLLM(["Say more about that."]) });
    h3.engine.restore(old);
    const out3 = await h3.send({ kind: "answer", text: "yes" }, 2);
    expect(out3.map((s) => s.kind)).toEqual(["followup"]);
  });

  it("test_offer_not_made_when_time_is_up", async () => {
    const h = harness({ target: 100 });
    await h.send({ kind: "start" });
    const o = await h.send({ kind: "silence_offer_next" }, 80);
    expect(o.length).toBeGreaterThan(0);
    expect(o.every((s) => s.kind === "closing")).toBe(true);
    expect(h.engine.isClosed()).toBe(true);
    expect(await h.send({ kind: "answer", text: "late" })).toEqual([]);
  });

  it("test_tags_are_balanced", async () => {
    const tags = ["a", "a", "a", "b", "b", "c"];
    const b = bank(6, (i) => q(i, { tags: [tags[i - 1] ?? "z"] }));
    const h = harness({ bank: b, llm: createFakeLLM(["[NEXT]", "[NEXT]", "[NEXT]"]), target: 6000 });
    await h.send({ kind: "start" });
    for (let i = 0; i < 2; i++) await h.send({ kind: "answer", text: "x" }, 10);
    const asked = h.log.filter((s) => s.kind === "question").map((s) => s.questionId);
    expect(asked).toEqual(["q1", "q4", "q6"]);
  });

  it("test_state_roundtrip_resumes_session", async () => {
    const h = harness({ llm: createFakeLLM(["[NEXT]"]) });
    await h.send({ kind: "start" });
    await h.send({ kind: "answer", text: "First." }, 10);
    const saved = JSON.parse(JSON.stringify(h.engine.state()));
    const h2 = harness({});
    h2.engine.restore(saved);
    expect(h2.engine.isClosed()).toBe(false);
    expect(await h2.send({ kind: "start" })).toEqual([]); // already started
    const out = await h2.send({ kind: "answer", text: "Second." }, 10);
    expect(out.every((s) => s.questionId === "q2" || s.kind === "question")).toBe(true);
    const later = h2.log.filter((s) => s.kind === "question").map((s) => s.questionId);
    expect(later).not.toContain("q1");
  });

  it("test_abort_stops_generation", async () => {
    const ac = new AbortController();
    const llm = createFakeLLM(["One two three. Four five six."]);
    const h = harness({ llm });
    await h.send({ kind: "start" });
    ac.abort();
    const out = await collect(h.engine.next({ kind: "answer", text: "x" }, { signal: ac.signal }));
    expect(out).toEqual([]);
  });
});

describe("providers", () => {
  it("test_paid_provider_requires_flag", () => {
    expect(() => createClaudeLLM({ env: { ANTHROPIC_API_KEY: "k" } })).toThrow(/ALLOW_PAID/);
    expect(() => createClaudeLLM({ env: { ANTHROPIC_API_KEY: "k", ALLOW_PAID: "0" } })).toThrow(/ALLOW_PAID/);
    expect(() => createLLMProvider({ LLM_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" })).toThrow(/ALLOW_PAID/);
  });

  it("test_provider_factory_builds_fake_and_local", () => {
    expect(createLLMProvider({ LLM_PROVIDER: "fake" }).name).toBe("fake");
    expect(createLLMProvider({ LLM_PROVIDER: "local", LOCAL_LLM_URL: "http://127.0.0.1:1/v1" }).name).toBe("local");
    expect(() => createLLMProvider({ LLM_PROVIDER: "nope" })).toThrow(/LLM_PROVIDER/);
  });

  it("test_local_parses_openai_stream", async () => {
    const sse =
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo."}}]}\n\ndata: [DONE]\n\n';
    let body = "";
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(sse, { status: 200 });
    }) as typeof fetch;
    const llm = createLocalLLM({ url: "http://x/v1", model: "m", fetchFn });
    const parts: string[] = [];
    for await (const p of llm.stream([{ role: "user", content: "hi" }])) parts.push(p);
    expect(parts.join("")).toBe("Hello.");
    expect(JSON.parse(body).stream).toBe(true);
    expect(JSON.parse(body).chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("test_claude_parses_stream_and_splits_system", async () => {
    const sse =
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi "}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"there."}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';
    let sent: { system?: string; messages: Array<{ role: string }>; model: string } | undefined;
    let headers: Record<string, string> = {};
    const fetchFn = (async (_u: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      headers = init?.headers as Record<string, string>;
      return new Response(sse, { status: 200 });
    }) as typeof fetch;
    const llm = createClaudeLLM({ env: { ALLOW_PAID: "1", ANTHROPIC_API_KEY: "test-key" }, fetchFn });
    const parts: string[] = [];
    for await (const p of llm.stream([{ role: "system", content: "S" }, { role: "user", content: "U" }])) parts.push(p);
    expect(parts.join("")).toBe("Hi there.");
    expect(sent?.system).toBe("S");
    expect(sent?.messages).toEqual([{ role: "user", content: "U" }]);
    expect(sent?.model).toBe("claude-sonnet-5-5");
    expect(headers["x-api-key"]).toBe("test-key");
  });
});

describe("prompt order", () => {
  it("test_prompt_keeps_stable_text_first_and_question_last", async () => {
    const { buildSystemPrompt } = await import("./engine.ts");
    const mk = (text: string) =>
      buildSystemPrompt({
        profile: { persona: "PERSONA" } as never,
        question: { text, doNotSay: ["SECRET LINE"] } as never,
        roleContext: "SETUP NOTE",
      });
    const a = mk("First question?");
    const b = mk("Second question?");
    // Everything before the question is identical, so a server can reuse its cache up to there.
    const cut = a.indexOf("The question you asked");
    expect(cut).toBeGreaterThan(0);
    expect(a.slice(0, cut)).toBe(b.slice(0, cut));
    expect(a.indexOf("PERSONA")).toBeLessThan(a.indexOf("Rules you always follow"));
    expect(a.indexOf("SETUP NOTE")).toBeLessThan(a.indexOf("First question?"));
    expect(a.indexOf("First question?")).toBeLessThan(a.indexOf("SECRET LINE"));
  });
});
