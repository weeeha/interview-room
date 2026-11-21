import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { InterviewerProfile, QuestionBank, Session, Turn } from "../../shared/types.ts";
import { loadBanks } from "./banks/load.ts";
import { createEngine, type Engine, type EngineEvent, type EngineSentence } from "./interviewer/engine.ts";
import { PROFILES } from "./interviewer/profiles.ts";
import { createLogger } from "./log.ts";
import type { Providers } from "./providers/index.ts";
import type { LLMProvider } from "./providers/llm/types.ts";

const log = createLogger("session");

export class HttpError extends Error {
  status: 400 | 404 | 409 | 500;
  constructor(status: 400 | 404 | 409 | 500, message: string) {
    super(message);
    this.status = status;
  }
}

export type TurnKind = "start" | "answer" | "silence_prompt" | "silence_offer_next";

export type PrevInfo = {
  turnIndex: number;
  gapMs?: number;
  ttsFirstAudioMs?: number;
  playbackEndMs?: number;
  /** Ms since session start (client clock) when playback was stopped. */
  interruptStopMs?: number;
  interrupted?: boolean;
  /** Optional: the text actually spoken before playback stopped. */
  spokenText?: string;
  /** Optional profiling marks measured in the browser, ms from the candidate's end of speech. */
  clientStages?: Record<string, number>;
};

export type TurnMeta = {
  kind: TurnKind;
  speechStartMs?: number;
  speechEndMs?: number;
  prev?: PrevInfo;
};

export type TurnLine =
  | { type: "transcript"; turnIndex: number; text: string; sttMs: number }
  | { type: "sentence"; turnIndex: number; sentenceIndex: number; text: string; kind: Turn["kind"] }
  | { type: "audio"; turnIndex: number; sentenceIndex: number; url: string }
  | { type: "done"; turnIndex: number; kind: Turn["kind"]; closing: boolean; latency: { sttMs: number; llmFirstTokenMs: number } }
  | { type: "error"; stage: "stt" | "llm" | "tts"; message: string };

export type CreateSessionInput = {
  roomId: string;
  bankId: string;
  profileId: string;
  targetDurationSec?: number;
  roleContext?: string;
};

export type ReportStatus = "none" | "generating" | "ready" | "failed";

export type SessionServiceOptions = {
  getProviders: () => Providers;
  sessionsDir: string;
  banksDir: string;
  /** Wall clock in ms. Injected by tests. */
  now?: () => number;
  /** Called once when a session ends. The feedback pass plugs in here. */
  onSessionEnded?: (session: Session) => void | Promise<void>;
  /** Report status source (the feedback service). Without it get() reports "none" or "ready" from report.json. */
  reports?: { info(id: string): Promise<{ report?: unknown; reportStatus: ReportStatus; reportStage?: string; reportError?: string; reportWarnings?: string[] }> };
};

type Timing = { mark: number; first?: number };
type Entry = {
  session: Session;
  engine: Engine;
  bank: QuestionBank;
  profile: InterviewerProfile;
  timing: Timing;
  queue: Promise<unknown>;
  /** Transcripts started before the turn request, keyed by a hash of the exact audio. */
  ahead: Map<string, { result: Promise<{ text: string; ms: number }>; at: number }>;
};

// Latency fields are filled in as the data arrives, so some are missing for a while.
type PartialLatency = { sttMs?: number; llmFirstTokenMs?: number; ttsFirstAudioMs?: number; gapMs?: number };

const ID_RE = /^[a-z0-9]{6,32}$/;
const FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KINDS: TurnKind[] = ["start", "answer", "silence_prompt", "silence_offer_next"];

function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function parseTurnMeta(raw: unknown): TurnMeta {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      throw new HttpError(400, "meta is not valid JSON");
    }
  }
  if (!v || typeof v !== "object") throw new HttpError(400, "meta must be a JSON object");
  const o = v as Record<string, unknown>;
  if (!KINDS.includes(o.kind as TurnKind)) throw new HttpError(400, `meta.kind must be one of ${KINDS.join(", ")}`);
  const meta: TurnMeta = { kind: o.kind as TurnKind };
  const s = finite(o.speechStartMs);
  const e = finite(o.speechEndMs);
  if (s !== undefined) meta.speechStartMs = s;
  if (e !== undefined) meta.speechEndMs = e;
  if (o.prev && typeof o.prev === "object") meta.prev = parsePrev(o.prev as Record<string, unknown>);
  return meta;
}

export function parsePrev(p: Record<string, unknown>): PrevInfo {
  const turnIndex = finite(p.turnIndex);
  if (turnIndex === undefined) throw new HttpError(400, "prev.turnIndex must be a number");
  const prev: PrevInfo = { turnIndex };
  for (const k of ["gapMs", "ttsFirstAudioMs", "playbackEndMs", "interruptStopMs"] as const) {
    const n = finite(p[k]);
    if (n !== undefined) prev[k] = n;
  }
  if (typeof p.interrupted === "boolean") prev.interrupted = p.interrupted;
  if (typeof p.spokenText === "string") prev.spokenText = p.spokenText;
  if (p.clientStages && typeof p.clientStages === "object") {
    const marks: Record<string, number> = {};
    for (const [k, v] of Object.entries(p.clientStages as Record<string, unknown>)) {
      const n = finite(v);
      if (n !== undefined && /^[A-Za-z0-9]{1,24}$/.test(k) && Object.keys(marks).length < 16) marks[k] = Math.round(n);
    }
    if (Object.keys(marks).length > 0) prev.clientStages = marks;
  }
  return prev;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
}

export function createSessionService(opts: SessionServiceOptions) {
  const clock = opts.now ?? Date.now;
  const sessionsDir = resolve(opts.sessionsDir);
  const entries = new Map<string, Entry>();
  const hook = opts.onSessionEnded ?? (() => undefined);

  const dirOf = (id: string) => join(sessionsDir, id);
  const elapsed = (s: Session) => Math.max(0, clock() - Date.parse(s.startedAt));

  function checkId(id: string): void {
    if (!ID_RE.test(id)) throw new HttpError(404, "Session not found");
  }

  function banks(): QuestionBank[] {
    return loadBanks(opts.banksDir);
  }

  function buildEntry(session: Session, engineState?: object): Entry {
    const bank = banks().find((b) => b.id === session.bankId);
    if (!bank) throw new HttpError(400, `Question bank "${session.bankId}" was not found in the bank folder`);
    const profile = PROFILES.find((p) => p.id === session.profileId);
    if (!profile) throw new HttpError(400, `Unknown interviewer style "${session.profileId}"`);
    const timing: Timing = { mark: 0 };
    const base = opts.getProviders().llm;
    // Wraps the provider only to see when the first token arrives.
    const llm: LLMProvider = {
      name: base.name,
      async *stream(messages, o) {
        for await (const chunk of base.stream(messages, o)) {
          if (timing.first === undefined) timing.first = clock() - timing.mark;
          yield chunk;
        }
      },
    };
    const engine = createEngine({
      bank,
      profile,
      targetDurationSec: session.targetDurationSec,
      roleContext: session.roleContext,
      llm,
      now: () => elapsed(session),
    });
    if (engineState) engine.restore(engineState);
    return { session, engine, bank, profile, timing, queue: Promise.resolve(), ahead: new Map() };
  }

  async function persist(entry: Entry): Promise<void> {
    const dir = dirOf(entry.session.id);
    await mkdir(dir, { recursive: true });
    await writeJsonAtomic(join(dir, "engine.json"), entry.engine.state());
    await writeJsonAtomic(join(dir, "session.json"), entry.session);
  }

  async function readSessionFile(id: string): Promise<Session | undefined> {
    try {
      return JSON.parse(await readFile(join(dirOf(id), "session.json"), "utf8")) as Session;
    } catch {
      return undefined;
    }
  }

  async function getEntry(id: string): Promise<Entry> {
    checkId(id);
    const cached = entries.get(id);
    if (cached) return cached;
    const session = await readSessionFile(id);
    if (!session) throw new HttpError(404, "Session not found");
    let state: object | undefined;
    try {
      state = JSON.parse(await readFile(join(dirOf(id), "engine.json"), "utf8")) as object;
    } catch {
      state = undefined;
    }
    const entry = buildEntry(session, state);
    entries.set(id, entry);
    return entry;
  }

  /** Runs work for one session at a time. */
  function enqueue<T>(entry: Entry, work: () => Promise<T>): Promise<T> {
    const run = entry.queue.then(work, work);
    entry.queue = run.catch(() => undefined);
    return run;
  }

  function applyPrev(entry: Entry, prev: PrevInfo | undefined): void {
    if (!prev) return;
    const { session, engine } = entry;
    const turn = session.turns.find((t) => t.index === prev.turnIndex && t.role === "interviewer");
    if (!turn) return;
    const lat = ((turn.latency ??= {} as Turn["latency"] & object) as PartialLatency);
    if (prev.gapMs !== undefined) lat.gapMs = prev.gapMs;
    if (prev.ttsFirstAudioMs !== undefined) lat.ttsFirstAudioMs = prev.ttsFirstAudioMs;
    if (prev.clientStages) turn.stages = { ...turn.stages, client: prev.clientStages };
    // Stop and end times come from the browser, which counts from the session's startedAt. A turn
    // never ends before it starts: if the report says so, keep startMs and warn.
    const setEnd = (reported: number) => {
      if (reported < turn.startMs) {
        log.warn(`session ${session.id} turn ${turn.index}: reported end ${reported} ms is before start ${turn.startMs} ms, keeping the start`);
        turn.endMs = turn.startMs;
      } else turn.endMs = reported;
    };
    if (prev.interrupted) {
      turn.interrupted = true;
      if (prev.interruptStopMs !== undefined) setEnd(prev.interruptStopMs);
      else if (prev.playbackEndMs !== undefined) setEnd(prev.playbackEndMs);
    } else if (prev.playbackEndMs !== undefined) {
      setEnd(prev.playbackEndMs);
    }
    const lastInterviewer = [...session.turns].reverse().find((t) => t.role === "interviewer");
    if (prev.spokenText !== undefined) turn.text = prev.spokenText.trim();
    if (lastInterviewer?.index === turn.index && (prev.spokenText !== undefined || prev.interrupted)) {
      engine.commit(prev.spokenText ?? turn.text, prev.interrupted);
    }
  }

  async function create(input: CreateSessionInput): Promise<Session> {
    const bank = banks().find((b) => b.id === input.bankId);
    if (!bank) throw new HttpError(400, `Question bank "${input.bankId}" was not found`);
    const profile = PROFILES.find((p) => p.id === input.profileId);
    if (!profile) throw new HttpError(400, `Unknown interviewer style "${input.profileId}"`);
    const target = Number.isFinite(input.targetDurationSec) ? Math.round(input.targetDurationSec as number) : 600;
    const p = opts.getProviders();
    const t = clock();
    const session: Session = {
      id: t.toString(36).padStart(9, "0") + randomBytes(2).toString("hex"),
      startedAt: new Date(t).toISOString(),
      roomId: String(input.roomId || "interview-office"),
      bankId: bank.id,
      profileId: profile.id,
      targetDurationSec: Math.min(3600, Math.max(60, target)),
      ...(input.roleContext?.trim() ? { roleContext: input.roleContext.trim() } : {}),
      providers: { stt: p.stt.name, llm: p.llm.name, tts: p.tts.name },
      status: "created",
      turns: [],
    };
    const entry = buildEntry(session);
    entries.set(session.id, entry);
    await persist(entry);
    return session;
  }

  async function get(id: string): Promise<{ session: Session; report?: unknown; reportStatus: ReportStatus; reportStage?: string; reportError?: string; reportWarnings?: string[] }> {
    const entry = await getEntry(id);
    if (opts.reports) return { session: entry.session, ...(await opts.reports.info(id)) };
    let report: unknown;
    try {
      report = JSON.parse(await readFile(join(dirOf(id), "report.json"), "utf8"));
    } catch {
      report = undefined;
    }
    return report === undefined
      ? { session: entry.session, reportStatus: "none" }
      : { session: entry.session, report, reportStatus: "ready" };
  }

  async function list() {
    let names: string[];
    try {
      names = await readdir(sessionsDir);
    } catch {
      return [];
    }
    const titles = new Map(banks().map((b) => [b.id, b.title]));
    const out = [];
    for (const name of names.filter((n) => ID_RE.test(n))) {
      const s = entries.get(name)?.session ?? (await readSessionFile(name));
      if (!s) continue;
      const last = s.turns[s.turns.length - 1];
      out.push({
        id: s.id,
        startedAt: s.startedAt,
        ...(s.endedAt ? { endedAt: s.endedAt } : {}),
        bankId: s.bankId,
        bankTitle: titles.get(s.bankId) ?? s.bankId,
        profileId: s.profileId,
        targetDurationSec: s.targetDurationSec,
        durationSec: last ? Math.round(last.endMs / 1000) : 0,
        status: s.status,
        turnCount: s.turns.length,
      });
    }
    return out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : b.id.localeCompare(a.id)));
  }

  async function end(id: string, prev?: PrevInfo): Promise<void> {
    const entry = await getEntry(id);
    const ended = await enqueue(entry, async () => {
      applyPrev(entry, prev);
      const already = entry.session.status === "ended" || entry.session.status === "reported";
      if (!already) {
        entry.session.status = "ended";
        entry.session.endedAt = new Date(clock()).toISOString();
      }
      await persist(entry);
      return !already;
    });
    if (ended) {
      try {
        const r = hook(entry.session);
        if (r instanceof Promise) r.catch((e) => log.error(`onSessionEnded failed: ${errMsg(e)}`));
      } catch (e) {
        log.error(`onSessionEnded failed: ${errMsg(e)}`);
      }
    }
  }

  const AHEAD_MAX = 3;
  const AHEAD_TTL_MS = 120_000;
  const audioKey = (wav: Buffer) => createHash("sha256").update(wav).digest("hex");

  /**
   * Starts transcribing audio the browser sent at a pause. It is used only when the turn request later
   * carries exactly the same bytes, so a speaker who went on talking is never answered from a stale text.
   */
  async function transcribeAhead(id: string, wav: Buffer): Promise<void> {
    const entry = await getEntry(id);
    if (entry.session.status === "ended" || entry.session.status === "reported" || wav.length === 0) return;
    const key = audioKey(wav);
    if (entry.ahead.has(key)) return;
    const t = clock();
    for (const [k, v] of entry.ahead) if (t - v.at > AHEAD_TTL_MS) entry.ahead.delete(k);
    while (entry.ahead.size >= AHEAD_MAX) entry.ahead.delete(entry.ahead.keys().next().value as string);
    const result = opts.getProviders().stt.transcribe(wav);
    result.catch(() => undefined); // a failure here is seen again by the turn, which transcribes on its own
    entry.ahead.set(key, { result, at: t });
  }

  /** Checks that can fail before a response stream starts. */
  async function checkTurn(id: string, meta: TurnMeta, wav?: Buffer): Promise<void> {
    const entry = await getEntry(id);
    if (entry.session.status === "ended" || entry.session.status === "reported") {
      throw new HttpError(409, "This session has ended");
    }
    if (meta.kind === "answer" && !wav?.length) throw new HttpError(400, "An answer turn needs audio");
  }

  async function runTurn(
    id: string,
    meta: TurnMeta,
    wav: Buffer | undefined,
    signal: AbortSignal,
    emit: (line: TurnLine) => void,
    /** Wall clock ms when the request reached the server. Profiling only. */
    recvAt: number = clock(),
  ): Promise<void> {
    const entry = await getEntry(id);
    return enqueue(entry, () => processTurn(entry, meta, wav, signal, emit, recvAt));
  }

  async function processTurn(
    entry: Entry,
    meta: TurnMeta,
    wav: Buffer | undefined,
    signal: AbortSignal,
    emit: (line: TurnLine) => void,
    recvAt: number,
  ): Promise<void> {
    const { session, engine, profile } = entry;
    const stages: Record<string, number> = { startMs: Math.max(0, clock() - recvAt) };
    const mark = (name: string) => {
      stages[name] ??= Math.max(0, clock() - recvAt);
    };
    const providers = opts.getProviders();
    const dir = dirOf(session.id);
    applyPrev(entry, meta.prev);
    if (session.status === "ended" || session.status === "reported") {
      emit({ type: "error", stage: "llm", message: "This session has ended" });
      return;
    }

    const snapshot = { engine: engine.state(), turns: session.turns.length, status: session.status };
    const rollback = async () => {
      session.turns.length = snapshot.turns;
      session.status = snapshot.status;
      engine.restore(snapshot.engine);
      await persist(entry);
    };

    try {
      let event: EngineEvent;
      let sttMs: number | undefined;
      if (meta.kind === "answer") {
        let result: { text: string; ms: number };
        try {
          const key = audioKey(wav as Buffer);
          const early = entry.ahead.get(key);
          entry.ahead.clear();
          let used: { text: string; ms: number } | undefined;
          if (early) {
            try {
              used = await early.result;
              stages.sttAhead = 1;
            } catch {
              used = undefined; // the early try failed: transcribe again below
            }
          }
          result = used ?? (await providers.stt.transcribe(wav as Buffer));
        } catch (e) {
          emit({ type: "error", stage: "stt", message: errMsg(e) });
          await persist(entry);
          return;
        }
        const text = result.text.trim();
        sttMs = result.ms;
        mark("sttDoneMs");
        const candIdx = session.turns.length;
        emit({ type: "transcript", turnIndex: candIdx, text, sttMs });
        if (!text) {
          // Silence or noise: nothing to answer, the client keeps listening.
          await persist(entry);
          return;
        }
        const now = elapsed(session);
        await mkdir(join(dir, "audio"), { recursive: true });
        const file = `turn-${pad2(candIdx)}.wav`;
        await writeFile(join(dir, "audio", file), wav as Buffer);
        // The candidate is answering the question the interviewer asked last.
        const answering = [...session.turns].reverse().find((t) => t.role === "interviewer" && t.questionId)?.questionId;
        session.turns.push({
          index: candIdx,
          role: "candidate",
          kind: "answer",
          ...(answering ? { questionId: answering } : {}),
          text,
          audioPath: `audio/${file}`,
          startMs: meta.speechStartMs ?? now,
          endMs: meta.speechEndMs ?? now,
        });
        event = { kind: "answer", text };
      } else {
        event = { kind: meta.kind };
      }
      session.status = "running";

      const turnIndex = session.turns.length;
      const startMs = elapsed(session);
      entry.timing.mark = clock();
      entry.timing.first = undefined;
      const produced: EngineSentence[] = [];
      let firstSentenceAt: number | undefined;
      let firstAudioMs: number | undefined;
      let firstAudioPath: string | undefined;
      let ttsError: unknown;
      let ttsChain: Promise<void> = Promise.resolve();

      const synth = (s: EngineSentence, sentenceIndex: number) => async () => {
        if (signal.aborted || ttsError) return;
        try {
          const out = await providers.tts.synthesize(s.text, profile.voiceId);
          if (!out || signal.aborted) return;
          const file = `turn-${pad2(turnIndex)}-s${sentenceIndex}.wav`;
          await mkdir(join(dir, "audio"), { recursive: true });
          await writeFile(join(dir, "audio", file), out.wav);
          mark("audioLineMs");
          if (firstAudioMs === undefined) {
            firstAudioMs = clock() - (firstSentenceAt ?? clock());
            firstAudioPath = `audio/${file}`;
          }
          emit({ type: "audio", turnIndex, sentenceIndex, url: `/api/session/${session.id}/audio/${file}` });
        } catch (e) {
          ttsError = e;
        }
      };

      try {
        for await (const s of engine.next(event, { signal })) {
          if (signal.aborted || ttsError) break;
          const sentenceIndex = produced.length;
          produced.push(s);
          firstSentenceAt ??= clock();
          mark("firstSentenceMs");
          emit({ type: "sentence", turnIndex, sentenceIndex, text: s.text, kind: s.kind });
          ttsChain = ttsChain.then(synth(s, sentenceIndex));
        }
      } catch (e) {
        await ttsChain;
        emit({ type: "error", stage: "llm", message: errMsg(e) });
        await rollback();
        return;
      }
      await ttsChain;

      const spoken = produced.map((s) => s.text).join(" ");
      const appendInterviewerTurn = () => {
        const last = produced[produced.length - 1] as EngineSentence;
        const qid = [...produced].reverse().find((s) => s.questionId)?.questionId;
        if (entry.timing.first !== undefined) stages.llmFirstTokenMs = entry.timing.mark - recvAt + entry.timing.first;
        const latency: PartialLatency = { llmFirstTokenMs: entry.timing.first ?? 0 };
        if (sttMs !== undefined) latency.sttMs = sttMs;
        if (firstAudioMs !== undefined) latency.ttsFirstAudioMs = firstAudioMs;
        session.turns.push({
          index: turnIndex,
          role: "interviewer",
          kind: last.kind,
          ...(qid ? { questionId: qid } : {}),
          text: spoken,
          ...(firstAudioPath ? { audioPath: firstAudioPath } : {}),
          startMs,
          endMs: elapsed(session),
          latency: latency as Turn["latency"],
          stages: { server: stages },
        });
      };

      if (signal.aborted) {
        // Barge-in: keep what was produced.
        if (produced.length > 0) {
          appendInterviewerTurn();
          engine.commit(spoken, true);
        }
        await persist(entry);
        return;
      }
      if (ttsError) {
        emit({ type: "error", stage: "tts", message: errMsg(ttsError) });
        await rollback();
        return;
      }
      if (produced.length === 0) {
        // The interview is already closed, or a second start arrived.
        await persist(entry);
        emit({
          type: "done",
          turnIndex: Math.max(0, session.turns.length - 1),
          kind: "closing",
          closing: engine.isClosed(),
          latency: { sttMs: sttMs ?? 0, llmFirstTokenMs: 0 },
        });
        return;
      }
      appendInterviewerTurn();
      await persist(entry);
      const t = session.turns[session.turns.length - 1] as Turn;
      emit({
        type: "done",
        turnIndex,
        kind: t.kind,
        closing: engine.isClosed(),
        latency: { sttMs: sttMs ?? 0, llmFirstTokenMs: entry.timing.first ?? 0 },
      });
    } catch (e) {
      emit({ type: "error", stage: "llm", message: errMsg(e) });
      try {
        await rollback();
      } catch (e2) {
        log.error(`rollback failed: ${errMsg(e2)}`);
      }
    }
  }

  function audioPath(id: string, file: string): string | undefined {
    if (!ID_RE.test(id) || !FILE_RE.test(file) || file.includes("..")) return undefined;
    const p = join(dirOf(id), "audio", file);
    return existsSync(p) ? p : undefined;
  }

  return { create, get, list, end, checkTurn, runTurn, transcribeAhead, audioPath, sessionsDir };
}

export type SessionService = ReturnType<typeof createSessionService>;
