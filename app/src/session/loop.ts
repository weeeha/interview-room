// The turn loop of the room screen. No React and no browser globals: capture, playback, the
// server client and the timers are injected, so the whole thing runs under test with fakes.
//
// One cycle: send a request, play the interviewer's sentences as they stream in, wait for the
// candidate, send their answer. Speech while the interviewer is audible stops playback at once.
// Silence after the interviewer finishes triggers a prompt and then an offer to move on.
//
// Audio rule for each sentence line:
// - tts "speech" (the server has no audio for any sentence): enqueue it at once with no url,
//   and the playback queue speaks it with speechSynthesis.
// - tts "audio": the server sends sentence lines first and the audio lines after them, so each
//   sentence is held until its own `audio` line arrives, then enqueued with the url. Held
//   sentences that come before it in order and still have no audio are enqueued with no url
//   (spoken with speechSynthesis) so the order is kept. When the done line arrives, any sentence
//   still without audio is spoken the same way.

import type { PrevInfo, TurnKind, TurnLine, TurnMeta, TurnRequest } from "../api.ts";
import type { Playback, PlaybackItem } from "../audio/playback.ts";
import type { CapturedUtterance } from "../audio/capture.ts";

export type LoopPhase =
  | "idle" // not started
  | "thinking" // a request is in flight and nothing is audible yet
  | "interviewer" // the interviewer is audible
  | "listening" // waiting for the candidate
  | "candidate" // the candidate is speaking
  | "error"
  | "ending"
  | "ended";

export type LoopError = { stage: "stt" | "llm" | "tts" | "request" | "end"; message: string };

export type LoopSnapshot = {
  phase: LoopPhase;
  /** 0 normal, 1 after the silence prompt has been spoken. */
  silenceStage: 0 | 1;
  interviewerCaption: string;
  candidateCaption: string;
  /** Number of candidate turns the server has transcribed or accepted. */
  candidateTurns: number;
  error: LoopError | null;
  lastGapMs: number | null;
  lastInterruptStopMs: number | null;
};

export type LoopApi = {
  streamTurn(req: TurnRequest): AsyncIterable<TurnLine>;
  endSession(prev?: PrevInfo): Promise<void>;
  /** Optional: start transcribing the audio so far at a pause. Never awaited, failures ignored. */
  transcribeAhead?(audio: Blob): void;
};

export type LoopOptions = {
  api: LoopApi;
  playback: Pick<Playback, "enqueue" | "stop" | "onStart" | "onSentenceStart" | "onIdle" | "isPlaying">;
  capture: { setInterviewerSpeaking(on: boolean): void };
  /** "audio": the server sends WAV urls. "speech": the browser speaks every sentence. */
  tts: "audio" | "speech";
  /** Clock in ms. Must be the same clock the playback and the capture use (performance.now). */
  now: () => number;
  /** Time zero for every ms value sent to the server, on the `now` clock. */
  sessionStartMs: number;
  silencePromptSec: number;
  silenceOfferSec: number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  onChange?: (s: LoopSnapshot) => void;
  /** Called once the session is ended on the server (after a closing line or an End press). */
  onEnded?: () => void;
};

export type Loop = {
  /** Send the first request. "start" for a new session, "silence_prompt" to resume one. */
  start(kind?: "start" | "silence_prompt"): void;
  onSpeechStart(atMs: number): void;
  onUtterance(u: Pick<CapturedUtterance, "wav" | "speechStartMs" | "speechEndMs">): void;
  /** A pause inside an utterance: the audio so far may be the whole answer. */
  onPause(u: Pick<CapturedUtterance, "wav">): void;
  setMuted(on: boolean): void;
  retry(): void;
  end(): Promise<void>;
  dispose(): void;
  snapshot(): LoopSnapshot;
  /** For the debug line and tests. */
  internals(): { streaming: boolean; streamDone: boolean; turnFinished: boolean; held: number; timerOn: boolean };
};

type TurnRecord = {
  turnIndex: number;
  /** speechEndMs of the answer that led to this turn, if any. */
  answerEndMs?: number;
  firstSentenceAt?: number;
  audibleAt?: number;
  gapMs?: number;
  ttsFirstAudioMs?: number;
  /** Profiling marks on the `now` clock; reported as ms after the end of the candidate's speech. */
  marks: { detectedAt?: number; sentAt?: number; firstLineAt?: number; audioLineAt?: number };
  decodedAt?: number;
};

type Pending = { meta: TurnMeta; audio?: Blob };

export function createLoop(o: LoopOptions): Loop {
  const rel = (t: number) => t - o.sessionStartMs;

  let snap: LoopSnapshot = {
    phase: "idle",
    silenceStage: 0,
    interviewerCaption: "",
    candidateCaption: "",
    candidateTurns: 0,
    error: null,
    lastGapMs: null,
    lastInterruptStopMs: null,
  };
  const set = (patch: Partial<LoopSnapshot>) => {
    snap = { ...snap, ...patch };
    o.onChange?.(snap);
  };

  let ctrl: AbortController | null = null;
  let seq = 0;
  let streaming = false;
  let streamDone = false;
  let closing = false;
  let turnFinished = true;
  let emptyTranscript = false;
  let cur: TurnRecord | null = null;
  let prevInfo: PrevInfo | null = null; // timings of the last interviewer turn, sent with the next request
  let held: Array<{ turnIndex: number; sentenceIndex: number; text: string }> = [];
  let lastKind: TurnKind = "start";
  let lastRequest: Pending | null = null;
  let timer: unknown = null;
  let muted = false;
  let disposed = false;
  let ending = false;
  let retryEnd = false;
  let detectedAt: number | null = null; // when the capture handed over the last utterance

  const unsubscribers = [
    o.playback.onStart(({ atMs, decodedAtMs }) => {
      if (!cur || cur.audibleAt !== undefined) return;
      cur.audibleAt = atMs;
      cur.decodedAt = decodedAtMs;
      if (cur.answerEndMs !== undefined) {
        cur.gapMs = Math.max(0, Math.round(rel(atMs) - cur.answerEndMs));
        set({ lastGapMs: cur.gapMs });
      }
      if (cur.firstSentenceAt !== undefined) cur.ttsFirstAudioMs = Math.max(0, Math.round(atMs - cur.firstSentenceAt));
      o.capture.setInterviewerSpeaking(true);
      if (snap.phase === "thinking" || snap.phase === "listening") set({ phase: "interviewer" });
    }),
    o.playback.onSentenceStart(({ text }) => set({ interviewerCaption: text })),
    o.playback.onIdle(() => {
      o.capture.setInterviewerSpeaking(false);
      maybeFinished();
    }),
  ];

  function cancelTimer() {
    if (timer !== null) o.clearTimer(timer);
    timer = null;
  }

  function startSilenceTimer() {
    cancelTimer();
    if (muted || disposed || ending) return;
    const next: TurnKind = lastKind === "silence_prompt" ? "silence_offer_next" : "silence_prompt";
    const sec = next === "silence_prompt" ? o.silencePromptSec : o.silenceOfferSec;
    timer = o.setTimer(() => {
      timer = null;
      if (snap.phase !== "listening") return;
      void run(buildRequest(next));
    }, sec * 1000);
  }

  function buildRequest(kind: TurnKind, u?: Pick<CapturedUtterance, "wav" | "speechStartMs" | "speechEndMs">): Pending {
    const meta: TurnMeta = { kind };
    if (u) {
      meta.speechStartMs = Math.round(u.speechStartMs);
      meta.speechEndMs = Math.round(u.speechEndMs);
    }
    if (prevInfo) meta.prev = prevInfo;
    prevInfo = null;
    return { meta, audio: u?.wav };
  }

  function flushHeld(upToSentence = Infinity) {
    const send = held.filter((h) => h.sentenceIndex < upToSentence);
    held = held.filter((h) => h.sentenceIndex >= upToSentence);
    for (const h of send) o.playback.enqueue({ turnIndex: h.turnIndex, sentenceIndex: h.sentenceIndex, text: h.text } satisfies PlaybackItem);
  }

  function interviewerRecord(extra: Partial<PrevInfo> = {}): PrevInfo | null {
    if (!cur || cur.turnIndex < 0) return null;
    const info: PrevInfo = { turnIndex: cur.turnIndex, playbackEndMs: Math.round(rel(o.now())), ...extra };
    const stages = clientStages(cur);
    if (stages) info.clientStages = stages;
    if (cur.gapMs !== undefined) info.gapMs = cur.gapMs;
    if (cur.ttsFirstAudioMs !== undefined) info.ttsFirstAudioMs = cur.ttsFirstAudioMs;
    return info;
  }

  /** Where the gap went in the browser, ms after the end of the candidate's speech. Only for answered turns. */
  function clientStages(c: TurnRecord): Record<string, number> | undefined {
    if (c.answerEndMs === undefined) return undefined;
    const at = (t: number | undefined) => (t === undefined ? undefined : Math.round(rel(t) - (c.answerEndMs as number)));
    const out: Record<string, number> = {};
    const put = (k: string, v: number | undefined) => {
      if (v !== undefined) out[k] = v;
    };
    put("detectedMs", at(c.marks.detectedAt));
    put("sentMs", at(c.marks.sentAt));
    put("firstLineMs", at(c.marks.firstLineAt));
    put("sentenceMs", at(c.firstSentenceAt));
    put("audioLineMs", at(c.marks.audioLineAt));
    put("decodedMs", at(c.decodedAt));
    put("audibleMs", at(c.audibleAt));
    return Object.keys(out).length ? out : undefined;
  }

  function maybeFinished() {
    if (turnFinished || !streamDone || held.length > 0 || o.playback.isPlaying() || disposed) return;
    turnFinished = true;
    prevInfo = interviewerRecord();
    if (closing) {
      void finalize();
      return;
    }
    set({ phase: "listening", silenceStage: lastKind === "silence_prompt" ? 1 : 0 });
    startSilenceTimer();
  }

  function fail(error: LoopError) {
    // The server rolls the whole request back on an error, so what was queued is stale.
    held = [];
    o.playback.stop();
    o.capture.setInterviewerSpeaking(false);
    streaming = false;
    cancelTimer();
    ctrl?.abort();
    set({ phase: "error", error });
  }

  function handle(line: TurnLine) {
    if (cur) {
      cur.marks.firstLineAt ??= o.now();
      if (line.type === "audio") cur.marks.audioLineAt ??= o.now();
    }
    switch (line.type) {
      case "transcript":
        if (line.text.trim() === "") emptyTranscript = true; // nothing heard: the stream ends with no done line
        else set({ candidateCaption: line.text, candidateTurns: snap.candidateTurns + 1 });
        break;
      case "sentence": {
        if (cur) {
          cur.turnIndex = line.turnIndex;
          cur.firstSentenceAt ??= o.now();
        }
        if (o.tts === "speech") {
          o.playback.enqueue({ turnIndex: line.turnIndex, sentenceIndex: line.sentenceIndex, text: line.text });
        } else {
          held.push({ turnIndex: line.turnIndex, sentenceIndex: line.sentenceIndex, text: line.text });
        }
        break;
      }
      case "audio": {
        flushHeld(line.sentenceIndex);
        const mine = held.find((h) => h.turnIndex === line.turnIndex && h.sentenceIndex === line.sentenceIndex);
        held = held.filter((h) => h !== mine);
        const text = mine?.text ?? "";
        o.playback.enqueue({ turnIndex: line.turnIndex, sentenceIndex: line.sentenceIndex, text, url: line.url });
        break;
      }
      case "done":
        flushHeld();
        if (cur) cur.turnIndex = line.turnIndex;
        streaming = false;
        streamDone = true;
        closing = line.closing;
        maybeFinished();
        break;
      case "error":
        fail({ stage: line.stage, message: line.message });
        break;
    }
  }

  async function run(p: Pending): Promise<void> {
    if (disposed) return;
    cancelTimer();
    ctrl?.abort();
    const c = new AbortController();
    ctrl = c;
    const mySeq = ++seq;
    lastRequest = p;
    lastKind = p.meta.kind;
    streaming = true;
    streamDone = false;
    closing = false;
    turnFinished = false;
    emptyTranscript = false;
    held = [];
    cur = { turnIndex: -1, answerEndMs: p.meta.kind === "answer" ? p.meta.speechEndMs : undefined, marks: { detectedAt: detectedAt ?? undefined, sentAt: o.now() } };
    detectedAt = null;
    set({ phase: "thinking", error: null });
    try {
      for await (const line of o.api.streamTurn({ meta: p.meta, audio: p.audio, signal: c.signal })) {
        if (mySeq !== seq || c.signal.aborted) return;
        handle(line);
        if (snap.phase === "error") return;
      }
      if (mySeq !== seq || c.signal.aborted) return;
      if (emptyTranscript && !streamDone) {
        // Whisper heard nothing: keep listening, with the silence timer running again.
        streaming = false;
        turnFinished = true;
        cur = null;
        set({ phase: "listening", candidateCaption: "" });
        startSilenceTimer();
        return;
      }
      if (!streamDone) fail({ stage: "request", message: "The reply stopped before it finished." });
    } catch (err) {
      if (mySeq !== seq || c.signal.aborted) return;
      fail({ stage: "request", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** The candidate spoke over the interviewer. Silence the output, drop the stream, record it. */
  function bargeIn(speechStartAtMs: number) {
    const res = o.playback.stop();
    const stoppedAt = o.now();
    const stopMs = Math.max(0, Math.round(stoppedAt - (o.sessionStartMs + speechStartAtMs)));
    seq++; // any line still on its way is ignored
    ctrl?.abort();
    held = [];
    streaming = false;
    streamDone = true;
    turnFinished = true;
    o.capture.setInterviewerSpeaking(false);
    const audible = cur?.audibleAt !== undefined;
    const extra: Partial<PrevInfo> = audible ? { interrupted: true, interruptStopMs: Math.round(rel(stoppedAt)), spokenText: res.spokenText } : {};
    prevInfo = interviewerRecord(extra);
    if (audible) set({ lastInterruptStopMs: stopMs });
    cur = null;
  }

  async function finalize() {
    if (ending && !retryEnd) return;
    ending = true;
    retryEnd = false;
    cancelTimer();
    set({ phase: "ending", error: null });
    try {
      await o.api.endSession(prevInfo ?? undefined);
    } catch (err) {
      retryEnd = true;
      set({ phase: "error", error: { stage: "end", message: err instanceof Error ? err.message : String(err) } });
      return;
    }
    set({ phase: "ended" });
    o.onEnded?.();
  }

  return {
    start(kind = "start") {
      if (snap.phase !== "idle") return;
      void run(buildRequest(kind));
    },

    onSpeechStart(atMs) {
      if (disposed || ending || snap.phase === "idle" || snap.phase === "error") return;
      cancelTimer();
      if (streaming || o.playback.isPlaying()) bargeIn(atMs);
      set({ phase: "candidate", silenceStage: 0 });
    },

    onUtterance(u) {
      if (disposed || ending || snap.phase === "idle" || snap.phase === "error") return;
      cancelTimer();
      if (streaming || o.playback.isPlaying()) bargeIn(u.speechStartMs);
      set({ candidateCaption: "", silenceStage: 0 });
      detectedAt = o.now();
      void run(buildRequest("answer", u));
    },

    onPause(u) {
      if (disposed || ending || muted || snap.phase === "idle" || snap.phase === "error") return;
      try {
        o.api.transcribeAhead?.(u.wav);
      } catch {
        // an early transcript is only a speed-up
      }
    },

    setMuted(on) {
      muted = on;
      if (on) cancelTimer();
      else if (snap.phase === "listening") startSilenceTimer();
    },

    retry() {
      if (snap.phase !== "error") return;
      if (retryEnd) {
        void finalize();
        return;
      }
      if (lastRequest) void run(lastRequest);
    },

    async end() {
      if (ending && !retryEnd) return;
      seq++;
      ctrl?.abort();
      o.playback.stop();
      o.capture.setInterviewerSpeaking(false);
      held = [];
      streaming = false;
      await finalize();
    },

    dispose() {
      disposed = true;
      cancelTimer();
      seq++;
      ctrl?.abort();
      for (const off of unsubscribers) off();
    },

    snapshot: () => snap,
    internals: () => ({ streaming, streamDone, turnFinished, held: held.length, timerOn: timer !== null }),
  };
}
