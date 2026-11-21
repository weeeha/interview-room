import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../shared/types.ts";
import { createApp, type AppOptions } from "./index.ts";
import type { Providers } from "./providers/index.ts";
import { createFakeLLM } from "./providers/llm/fake.ts";
import type { LLMProvider } from "./providers/llm/types.ts";
import { createFakeSTT } from "./providers/stt/fake.ts";
import { createFakeTTS } from "./providers/tts/fake.ts";
import type { TurnLine } from "./session.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const ENV = { QUESTION_BANK_DIR: "./banks", STT_PROVIDER: "fake", LLM_PROVIDER: "fake", TTS_PROVIDER: "fake" };

function setup(over: Partial<Providers> = {}, extra: AppOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ir-sessions-"));
  dirs.push(dir);
  const clock = { t: Date.parse("2026-01-01T10:00:00Z") };
  const providers: Providers = {
    llm: createFakeLLM(),
    stt: createFakeSTT(),
    tts: createFakeTTS(),
    ...over,
  };
  const make = (prov: Providers = providers) =>
    createApp(ENV, { providers: prov, sessionsDir: dir, now: () => clock.t, ...extra });
  return { dir, clock, providers, app: make(), make };
}

type App = ReturnType<typeof createApp>;

async function create(app: App, body: object = {}): Promise<Session> {
  const res = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomId: "interview-office",
      bankId: "sample-bank",
      profileId: "neutral",
      targetDurationSec: 180,
      ...body,
    }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { session: Session }).session;
}

function turnForm(meta: object, withAudio = false): FormData {
  const f = new FormData();
  f.set("meta", JSON.stringify(meta));
  if (withAudio) f.set("audio", new Blob([new Uint8Array(3200)], { type: "audio/wav" }), "a.wav");
  return f;
}

function parseLines(text: string): TurnLine[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TurnLine);
}

async function turn(app: App, id: string, meta: object, withAudio = false): Promise<TurnLine[]> {
  const res = await app.request(`/api/session/${id}/turn`, { method: "POST", body: turnForm(meta, withAudio) });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/x-ndjson");
  return parseLines(await res.text());
}

async function getSession(app: App, id: string): Promise<Session> {
  return ((await (await app.request(`/api/session/${id}`)).json()) as { session: Session }).session;
}

describe("session create and read", () => {
  it("creates session.json and lists it", async () => {
    const { app, dir } = setup();
    const s = await create(app);
    expect(s.id).toMatch(/^[a-z0-9]{6,32}$/);
    expect(s.status).toBe("created");
    expect(s.providers).toEqual({ stt: "fake", llm: "fake", tts: "fake" });
    expect(existsSync(join(dir, s.id, "session.json"))).toBe(true);
    const got = (await (await app.request(`/api/session/${s.id}`)).json()) as { reportStatus: string; report?: unknown };
    expect(got.reportStatus).toBe("none");
    expect(got.report).toBeUndefined();
    const list = (await (await app.request("/api/sessions")).json()) as { sessions: Array<{ id: string; bankTitle: string }> };
    expect(list.sessions.map((x) => x.id)).toEqual([s.id]);
    expect(list.sessions[0]?.bankTitle).toBeTruthy();
  });

  it("rejects an unknown bank, an unknown style and an unknown session", async () => {
    const { app } = setup();
    const bad = await app.request("/api/session", {
      method: "POST",
      body: JSON.stringify({ roomId: "r", bankId: "nope", profileId: "neutral" }),
    });
    expect(bad.status).toBe(400);
    const bad2 = await app.request("/api/session", {
      method: "POST",
      body: JSON.stringify({ roomId: "r", bankId: "sample-bank", profileId: "grumpy" }),
    });
    expect(bad2.status).toBe(400);
    expect((await app.request("/api/session/abcdef123")).status).toBe(404);
    expect((await app.request("/api/session/..%2F..%2Fetc")).status).toBe(404);
  });

  it("test_config_exposes_silence_settings", async () => {
    const { app } = setup();
    expect(await (await app.request("/api/config")).json()).toEqual({
      silencePromptSec: 8,
      silenceOfferSec: 12,
      endOfSpeechMs: 1200,
    });
    const custom = createApp({ ...ENV, SILENCE_PROMPT_SEC: "5", SILENCE_OFFER_SEC: "9" });
    expect(await (await custom.request("/api/config")).json()).toMatchObject({ silencePromptSec: 5, silenceOfferSec: 9 });
  });
});

describe("turn stream", () => {
  it("start returns opening and the first question with audio, then done", async () => {
    const { app, dir } = setup();
    const s = await create(app);
    const lines = await turn(app, s.id, { kind: "start" });
    const sentences = lines.filter((l) => l.type === "sentence");
    const audios = lines.filter((l) => l.type === "audio");
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(audios.length).toBe(sentences.length);
    expect(lines[lines.length - 1]).toMatchObject({ type: "done", turnIndex: 0, kind: "question", closing: false });
    expect(lines.find((l) => l.type === "transcript")).toBeUndefined();
    const a = audios[0] as Extract<TurnLine, { type: "audio" }>;
    expect(a.url).toBe(`/api/session/${s.id}/audio/turn-00-s0.wav`);
    expect(existsSync(join(dir, s.id, "audio", "turn-00-s0.wav"))).toBe(true);
    const res = await app.request(a.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    const saved = await getSession(app, s.id);
    expect(saved.status).toBe("running");
    expect(saved.turns).toHaveLength(1);
    expect(saved.turns[0]).toMatchObject({ role: "interviewer", kind: "question" });
    expect(saved.turns[0]?.questionId).toBeTruthy();
    expect(saved.turns[0]?.latency).toMatchObject({ llmFirstTokenMs: 0 });
    expect(typeof saved.turns[0]?.latency?.ttsFirstAudioMs).toBe("number");
  });

  it("an answer returns the transcript line first, then a follow-up", async () => {
    const { app, dir } = setup({ stt: createFakeSTT(["I moved the team from paper checklists to a shared board."]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const lines = await turn(app, s.id, { kind: "answer", speechStartMs: 5000, speechEndMs: 20000 }, true);
    expect(lines[0]).toMatchObject({ type: "transcript", turnIndex: 1, text: expect.stringContaining("paper checklists"), sttMs: 1 });
    const done = lines[lines.length - 1];
    expect(done).toMatchObject({ type: "done", turnIndex: 2, kind: "followup" });
    const saved = await getSession(app, s.id);
    expect(saved.turns.map((t) => t.role)).toEqual(["interviewer", "candidate", "interviewer"]);
    expect(saved.turns[1]).toMatchObject({ kind: "answer", startMs: 5000, endMs: 20000, audioPath: "audio/turn-01.wav" });
    expect(existsSync(join(dir, s.id, "audio", "turn-01.wav"))).toBe(true);
    expect(saved.turns[2]?.latency?.sttMs).toBe(1);
  });

  it("test_streams_first_audio_before_llm_finishes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: LLMProvider = {
      name: "slow",
      async *stream() {
        yield "You mentioned the shared board. ";
        yield "What did people resist? ";
        await gate;
        yield "And then what changed?";
      },
    };
    const { app } = setup({ llm: slow, stt: createFakeSTT(["I introduced a shared board."]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const res = await app.request(`/api/session/${s.id}/turn`, { method: "POST", body: turnForm({ kind: "answer" }, true) });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let buf = "";
    const seen: TurnLine[] = [];
    while (!seen.some((l) => l.type === "audio")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const p of parts.filter(Boolean)) seen.push(JSON.parse(p) as TurnLine);
    }
    // The LLM gate is still closed, yet the first sentence already has audio.
    expect(seen.find((l) => l.type === "audio")).toBeTruthy();
    expect(seen.some((l) => l.type === "done")).toBe(false);
    release();
    let rest = buf;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += dec.decode(value);
    }
    expect(parseLines(rest).some((l) => l.type === "done")).toBe(true);
  });

  it("an empty transcript returns only the transcript line and no interviewer turn", async () => {
    const { app } = setup({ stt: createFakeSTT(["   "]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const lines = await turn(app, s.id, { kind: "answer" }, true);
    expect(lines).toEqual([{ type: "transcript", turnIndex: 1, text: "", sttMs: 1 }]);
    expect((await getSession(app, s.id)).turns).toHaveLength(1);
  });

  it("test_silence_prompts", async () => {
    const { app } = setup();
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const prompt = await turn(app, s.id, { kind: "silence_prompt" });
    expect(prompt.filter((l) => l.type === "sentence")).toEqual([
      expect.objectContaining({ kind: "prompt", text: "Whenever you are ready." }),
    ]);
    expect(prompt[prompt.length - 1]).toMatchObject({ type: "done", kind: "prompt" });
    const offer = await turn(app, s.id, { kind: "silence_offer_next" });
    const kinds = offer.filter((l) => l.type === "sentence").map((l) => (l as { kind: string }).kind);
    expect(kinds).toEqual(["prompt", "question"]);
    expect(offer[offer.length - 1]).toMatchObject({ type: "done", kind: "question" });
    const saved = await getSession(app, s.id);
    const qs = saved.turns.filter((t) => t.kind === "question").map((t) => t.questionId);
    expect(new Set(qs).size).toBe(qs.length);
    expect(saved.turns.map((t) => t.kind)).toEqual(["question", "prompt", "question"]);
  });

  it("test_barge_in_stops_playback (server side: interruption and spoken text are recorded)", async () => {
    const llm = createFakeLLM();
    const { app } = setup({ llm, stt: createFakeSTT(["I introduced a shared board for the team."]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const before = (await getSession(app, s.id)).turns[0];
    expect(before?.interrupted).toBeUndefined();
    await turn(
      app,
      s.id,
      {
        kind: "answer",
        speechStartMs: 9000,
        speechEndMs: 14000,
        prev: {
          turnIndex: 0,
          gapMs: 1800,
          ttsFirstAudioMs: 600,
          interrupted: true,
          interruptStopMs: 8800,
          spokenText: "Hello, thanks for joining.",
        },
      },
      true,
    );
    const saved = await getSession(app, s.id);
    const t0 = saved.turns[0];
    expect(t0).toMatchObject({ interrupted: true, endMs: 8800, text: "Hello, thanks for joining." });
    expect(t0?.latency).toMatchObject({ gapMs: 1800, ttsFirstAudioMs: 600 });
    // Stop time against the candidate's speech start: 200 ms, inside the 500 ms bar.
    expect((saved.turns[1]?.startMs ?? 0) - (t0?.endMs ?? 0)).toBeLessThan(500);
    // The model saw only the spoken text, not the unspoken question.
    const lastCall = llm.calls[llm.calls.length - 1] ?? [];
    const user = lastCall.map((m) => m.content).join("\n");
    expect(user).toContain("Interviewer: Hello, thanks for joining.");
    expect(user).not.toContain("Let's begin");
  });

  it("prev without interruption sets gap and playback end", async () => {
    const { app } = setup();
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    await turn(app, s.id, { kind: "silence_prompt", prev: { turnIndex: 0, gapMs: 2100, playbackEndMs: 7000 } });
    const t0 = (await getSession(app, s.id)).turns[0];
    expect(t0).toMatchObject({ endMs: 7000 });
    expect(t0?.interrupted).toBeUndefined();
    expect(t0?.latency?.gapMs).toBe(2100);
  });

  it("an error line when stt throws, and the session stays resumable", async () => {
    const { app } = setup({ stt: createFakeSTT([new Error("whisper is down"), "Here is my answer about the board."]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const bad = await turn(app, s.id, { kind: "answer" }, true);
    expect(bad).toEqual([{ type: "error", stage: "stt", message: "whisper is down" }]);
    expect((await getSession(app, s.id)).turns).toHaveLength(1);
    const ok = await turn(app, s.id, { kind: "answer" }, true);
    expect(ok[0]).toMatchObject({ type: "transcript", turnIndex: 1 });
    expect(ok[ok.length - 1]).toMatchObject({ type: "done" });
    expect((await getSession(app, s.id)).turns).toHaveLength(3);
  });

  it("a tts failure writes an error line and rolls the turn back so a retry is clean", async () => {
    let fail = true;
    const tts = {
      name: "flaky",
      async synthesize(text: string, voice: string) {
        if (fail) throw new Error("kokoro down");
        return createFakeTTS().synthesize(text, voice);
      },
    };
    const { app } = setup({ tts });
    const s = await create(app);
    const bad = await turn(app, s.id, { kind: "start" });
    expect(bad.some((l) => l.type === "error" && l.stage === "tts")).toBe(true);
    expect(bad.some((l) => l.type === "done")).toBe(false);
    expect((await getSession(app, s.id)).turns).toHaveLength(0);
    fail = false;
    const ok = await turn(app, s.id, { kind: "start" });
    expect(ok[ok.length - 1]).toMatchObject({ type: "done", turnIndex: 0, kind: "question" });
  });

  it("an llm failure falls back to the bank hint or the next question and never breaks the session", async () => {
    const { app } = setup({ llm: createFakeLLM([new Error("llm down")]), stt: createFakeSTT(["An answer."]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const lines = await turn(app, s.id, { kind: "answer" }, true);
    expect(lines[lines.length - 1]).toMatchObject({ type: "done" });
  });

  it("a turn on an ended session is refused with 409", async () => {
    const { app } = setup();
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    expect((await app.request(`/api/session/${s.id}/end`, { method: "POST", body: "{}" })).status).toBe(200);
    const res = await app.request(`/api/session/${s.id}/turn`, { method: "POST", body: turnForm({ kind: "silence_prompt" }) });
    expect(res.status).toBe(409);
  });

  it("rejects bad meta and an answer without audio", async () => {
    const { app } = setup();
    const s = await create(app);
    const r1 = await app.request(`/api/session/${s.id}/turn`, { method: "POST", body: turnForm({ kind: "dance" }) });
    expect(r1.status).toBe(400);
    const r2 = await app.request(`/api/session/${s.id}/turn`, { method: "POST", body: turnForm({ kind: "answer" }) });
    expect(r2.status).toBe(400);
  });

  it("an aborted turn stops the LLM and keeps what was produced", async () => {
    let closed = false;
    const llm: LLMProvider = {
      name: "slowllm",
      async *stream(_m, o) {
        try {
          yield "You mentioned the shared board. ";
          yield "What did";
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 3000);
            o?.signal?.addEventListener("abort", () => {
              clearTimeout(t);
              resolve();
            });
          });
          if (o?.signal?.aborted) return;
          yield "Never reached.";
        } finally {
          closed = true;
        }
      },
    };
    const { app } = setup({ llm, stt: createFakeSTT(["I introduced a shared board."]) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const ac = new AbortController();
    const res = await app.request(`/api/session/${s.id}/turn`, {
      method: "POST",
      body: turnForm({ kind: "answer" }, true),
      signal: ac.signal,
    });
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const dec = new TextDecoder();
    let text = "";
    while (!text.includes('"type":"sentence"')) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value);
    }
    ac.abort();
    await reader.cancel().catch(() => undefined);
    await vi.waitFor(async () => {
      const turns = (await getSession(app, s.id)).turns;
      expect(turns).toHaveLength(3);
    });
    expect(closed).toBe(true);
    const saved = await getSession(app, s.id);
    expect(saved.turns[2]?.text).toContain("You mentioned the shared board.");
    expect(saved.turns[2]?.text).not.toContain("Never reached");
    // Not a failure: the session accepts the next turn.
    const next = await turn(app, s.id, { kind: "silence_prompt" });
    expect(next[next.length - 1]).toMatchObject({ type: "done" });
  });
});

describe("full session and resume", () => {
  it("test_scripted_session_reaches_closing_without_repeats", async () => {
    const { app, clock } = setup();
    const s = await create(app, { targetDurationSec: 180 });
    let lines = await turn(app, s.id, { kind: "start" });
    let closing = false;
    for (let i = 0; i < 12 && !closing; i++) {
      clock.t += 25_000;
      const prev = lines.find((l) => l.type === "done") as Extract<TurnLine, { type: "done" }>;
      lines = await turn(app, s.id, { kind: "answer", prev: { turnIndex: prev.turnIndex, gapMs: 1500 } }, true);
      closing = (lines.find((l) => l.type === "done") as Extract<TurnLine, { type: "done" }>).closing;
    }
    expect(closing).toBe(true);
    const saved = await getSession(app, s.id);
    const last = saved.turns[saved.turns.length - 1];
    expect(last?.kind).toBe("closing");
    const qs = saved.turns.filter((t) => t.kind === "question").map((t) => t.questionId);
    expect(qs.length).toBeGreaterThanOrEqual(3);
    expect(new Set(qs).size).toBe(qs.length);
    const followsPerQ = new Map<string, number>();
    for (const t of saved.turns) if (t.kind === "followup" && t.questionId) followsPerQ.set(t.questionId, (followsPerQ.get(t.questionId) ?? 0) + 1);
    for (const n of followsPerQ.values()) expect(n).toBeLessThanOrEqual(2);
    const closeSec = (last?.startMs ?? 0) / 1000;
    // The engine closes at the first turn boundary after target minus 60 s.
    expect(closeSec).toBeGreaterThanOrEqual(120);
    expect(closeSec).toBeLessThanOrEqual(1.1 * 180);
    // A turn after the closing line yields nothing new.
    const after = await turn(app, s.id, { kind: "answer" }, true);
    expect(after.some((l) => l.type === "sentence")).toBe(false);
  });

  it("test_end_calls_hook_once_and_marks_ended", async () => {
    const ended: Session[] = [];
    const { app } = setup({}, { onSessionEnded: (s) => void ended.push(structuredClone(s)) });
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    const body = JSON.stringify({ prev: { turnIndex: 0, gapMs: 1200 } });
    for (let i = 0; i < 2; i++) {
      const res = await app.request(`/api/session/${s.id}/end`, { method: "POST", body });
      expect(await res.json()).toEqual({ ok: true });
    }
    expect(ended).toHaveLength(1);
    expect(ended[0]?.status).toBe("ended");
    const saved = await getSession(app, s.id);
    expect(saved.status).toBe("ended");
    expect(saved.endedAt).toBeTruthy();
    expect(saved.turns[0]?.latency?.gapMs).toBe(1200);
  });

  it("test_restart_resumes_from_disk", async () => {
    const first = setup({ stt: createFakeSTT(["I introduced a shared board."]) });
    const s = await create(first.app);
    const l1 = await turn(first.app, s.id, { kind: "start" });
    const q1 = (l1.filter((l) => l.type === "sentence").pop() as { text: string }).text;
    await turn(first.app, s.id, { kind: "answer" }, true);
    const onDisk = JSON.parse(readFileSync(join(first.dir, s.id, "session.json"), "utf8")) as Session;
    expect(onDisk.turns).toHaveLength(3);
    expect(existsSync(join(first.dir, s.id, "engine.json"))).toBe(true);
    // New app, same folder: a server restart.
    const second = createApp(ENV, {
      providers: { llm: createFakeLLM(), stt: createFakeSTT(["Another answer about the board."]), tts: createFakeTTS() },
      sessionsDir: first.dir,
      now: () => first.clock.t + 30_000,
    });
    const resumed = await getSession(second, s.id);
    expect(resumed.turns).toHaveLength(3);
    const lines = await turn(second, s.id, { kind: "answer" }, true);
    expect(lines[lines.length - 1]).toMatchObject({ type: "done", turnIndex: 4 });
    const after = await getSession(second, s.id);
    expect(after.turns).toHaveLength(5);
    // The engine kept its memory: the first question is not asked again.
    const texts = after.turns.filter((t) => t.kind === "question").map((t) => t.text);
    expect(texts.filter((t) => t === q1).length).toBeLessThanOrEqual(1);
  });
});

describe("audio route", () => {
  it("blocks path traversal and unknown files", async () => {
    const { app } = setup();
    const s = await create(app);
    await turn(app, s.id, { kind: "start" });
    expect((await app.request(`/api/session/${s.id}/audio/..%2Fsession.json`)).status).toBe(404);
    expect((await app.request(`/api/session/${s.id}/audio/..%2F..%2F${s.id}%2Fsession.json`)).status).toBe(404);
    expect((await app.request(`/api/session/${s.id}/audio/nope.wav`)).status).toBe(404);
    expect((await app.request(`/api/session/${s.id}/audio/turn-00-s0.wav`)).status).toBe(200);
  });
});
