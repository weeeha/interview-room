import { describe, expect, it } from "vitest";
import type { PrevInfo, TurnLine, TurnRequest } from "../api.ts";
import { createLoop, type LoopOptions } from "./loop.ts";

// A manual clock with timers: advance(ms) runs everything that is due.
function makeClock() {
  let t = 1000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => void timers.delete(h as number),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

function makeFakePlayback(clock: ReturnType<typeof makeClock>) {
  const starts: Array<(e: { turnIndex: number; atMs: number }) => void> = [];
  const sentences: Array<(e: { turnIndex: number; sentenceIndex: number; text: string }) => void> = [];
  const idles: Array<() => void> = [];
  const enqueued: Array<{ turnIndex: number; sentenceIndex: number; text: string; url?: string }> = [];
  let playing = false;
  let stops = 0;
  return {
    enqueued,
    get stops() {
      return stops;
    },
    api: {
      enqueue(item: (typeof enqueued)[number]) {
        enqueued.push(item);
        playing = true;
      },
      stop() {
        stops++;
        playing = false;
        return { playedMs: 900, spokenText: "Tell me about a", sentences: [] };
      },
      onStart: (cb: (typeof starts)[number]) => (starts.push(cb), () => {}),
      onSentenceStart: (cb: (typeof sentences)[number]) => (sentences.push(cb), () => {}),
      onIdle: (cb: () => void) => (idles.push(cb), () => {}),
      isPlaying: () => playing,
    },
    /** First sample of the interviewer is audible. */
    audible(turnIndex: number, text = "") {
      for (const cb of starts) cb({ turnIndex, atMs: clock.now() });
      for (const cb of sentences) cb({ turnIndex, sentenceIndex: 0, text });
    },
    finish() {
      playing = false;
      for (const cb of idles) cb();
    },
  };
}

// An async stream the test feeds line by line.
function makeStream(signal: AbortSignal) {
  const queue: Array<TurnLine | "end"> = [];
  let wake: (() => void) | null = null;
  return {
    push(...lines: TurnLine[]) {
      queue.push(...lines);
      wake?.();
    },
    end() {
      queue.push("end");
      wake?.();
    },
    iterable: (async function* () {
      for (;;) {
        while (queue.length === 0) {
          await new Promise<void>((r) => {
            wake = r;
            signal.addEventListener("abort", () => r(), { once: true });
          });
          if (signal.aborted) return;
        }
        const next = queue.shift()!;
        if (next === "end") return;
        yield next;
      }
    })(),
  };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(over: Partial<LoopOptions> = {}) {
  const clock = makeClock();
  const pb = makeFakePlayback(clock);
  const requests: Array<{ req: TurnRequest; stream: ReturnType<typeof makeStream> }> = [];
  const speaking: boolean[] = [];
  const ended: number[] = [];
  const endPrev: Array<PrevInfo | undefined> = [];
  const ahead: Blob[] = [];
  const loop = createLoop({
    api: {
      streamTurn(req) {
        const stream = makeStream(req.signal);
        requests.push({ req, stream });
        return stream.iterable;
      },
      async endSession(prev) {
        endPrev.push(prev);
      },
      transcribeAhead(audio) {
        ahead.push(audio);
      },
    },
    playback: pb.api,
    capture: { setInterviewerSpeaking: (on) => void speaking.push(on) },
    tts: "audio",
    now: clock.now,
    sessionStartMs: 1000,
    silencePromptSec: 8,
    silenceOfferSec: 12,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onEnded: () => void ended.push(1),
    ...over,
  });
  const turn = (index: number, text: string, closingFlag = false): TurnLine[] => [
    { type: "sentence", turnIndex: index, sentenceIndex: 0, text },
    { type: "audio", turnIndex: index, sentenceIndex: 0, url: `/a/${index}.wav` },
    { type: "done", turnIndex: index, closing: closingFlag },
  ];
  return { clock, pb, requests, speaking, ended, endPrev, ahead, loop, turn };
}

const wav = new Blob(["x"], { type: "audio/wav" });

describe("turn loop", () => {
  it("test_barge_in_stops_playback", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push({ type: "sentence", turnIndex: 0, sentenceIndex: 0, text: "Tell me about a project you led." });
    t.requests[0]!.stream.push({ type: "audio", turnIndex: 0, sentenceIndex: 0, url: "/a/0.wav" });
    await tick();
    expect(t.pb.enqueued).toEqual([{ turnIndex: 0, sentenceIndex: 0, text: "Tell me about a project you led.", url: "/a/0.wav" }]);
    t.clock.advance(100);
    t.pb.audible(0, "Tell me about a project you led.");
    expect(t.loop.snapshot().phase).toBe("interviewer");
    expect(t.speaking.at(-1)).toBe(true);

    // The candidate starts talking 200 ms ago (the VAD needs 150 ms to be sure) while the stream is still open.
    t.clock.advance(1200);
    const startedAt = t.clock.now() - 1000 - 200;
    t.loop.onSpeechStart(startedAt);
    expect(t.pb.stops).toBe(1);
    expect(t.requests[0]!.req.signal.aborted).toBe(true);
    expect(t.speaking.at(-1)).toBe(false);
    expect(t.loop.snapshot().phase).toBe("candidate");
    expect(t.loop.snapshot().lastInterruptStopMs).toBeLessThan(500);

    t.clock.advance(3000);
    t.loop.onUtterance({ wav, speechStartMs: startedAt, speechEndMs: startedAt + 3000 });
    await tick();
    const meta = t.requests[1]!.req.meta;
    expect(meta.kind).toBe("answer");
    expect(meta.prev).toMatchObject({ turnIndex: 0, interrupted: true, spokenText: "Tell me about a" });
    // A timestamp since the session start: the stop happened at the moment of the speech start callback.
    expect(meta.prev?.interruptStopMs).toBe(1200 + 100);
    expect(t.requests[1]!.req.audio).toBe(wav);
  });

  it("test_silence_prompts", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "First question."));
    await tick();
    t.pb.audible(0);
    t.pb.finish();
    expect(t.loop.snapshot().phase).toBe("listening");

    t.clock.advance(7999);
    await tick();
    expect(t.requests).toHaveLength(1);
    t.clock.advance(1);
    await tick();
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1]!.req.meta.kind).toBe("silence_prompt");
    expect(t.requests[1]!.req.meta.prev?.turnIndex).toBe(0);

    // The prompt is spoken, then 12 more seconds pass.
    t.requests[1]!.stream.push(...t.turn(1, "Take your time."));
    await tick();
    t.pb.audible(1);
    t.pb.finish();
    expect(t.loop.snapshot().silenceStage).toBe(1);
    t.clock.advance(11999);
    await tick();
    expect(t.requests).toHaveLength(2);
    t.clock.advance(1);
    await tick();
    expect(t.requests).toHaveLength(3);
    expect(t.requests[2]!.req.meta.kind).toBe("silence_offer_next");
  });

  it("does not run the silence timer while the interviewer is still streaming or talking", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push({ type: "sentence", turnIndex: 0, sentenceIndex: 0, text: "One." });
    t.requests[0]!.stream.push({ type: "audio", turnIndex: 0, sentenceIndex: 0, url: "/a/0.wav" });
    await tick();
    t.pb.audible(0);
    t.pb.finish(); // queue drained, but the reply has not finished
    t.clock.advance(60000);
    await tick();
    expect(t.requests).toHaveLength(1);
    expect(t.clock.pending()).toBe(0);
  });

  it("candidate speech cancels the silence timer", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "Q."));
    await tick();
    t.pb.audible(0);
    t.pb.finish();
    t.clock.advance(5000);
    t.loop.onSpeechStart(5000);
    t.clock.advance(20000);
    await tick();
    expect(t.requests).toHaveLength(1);
  });

  it("measures the gap from the end of the candidate speech to the first audible sample", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "Q."));
    await tick();
    t.pb.audible(0);
    t.pb.finish();
    t.clock.advance(4000);
    t.loop.onSpeechStart(3000);
    t.clock.advance(2000);
    const endMs = t.clock.now() - 1000; // speech ended now (ms since session start)
    t.loop.onUtterance({ wav, speechStartMs: 3000, speechEndMs: endMs });
    await tick();
    t.requests[1]!.stream.push({ type: "transcript", turnIndex: 1, text: "my answer", sttMs: 300 });
    t.requests[1]!.stream.push(...t.turn(2, "Follow up."));
    await tick();
    t.clock.advance(2300);
    t.pb.audible(2);
    expect(t.loop.snapshot().lastGapMs).toBe(2300);
    expect(t.loop.snapshot().candidateCaption).toBe("my answer");
    t.pb.finish();
    t.clock.advance(8000);
    await tick();
    expect(t.requests[2]!.req.meta.prev).toMatchObject({ turnIndex: 2, gapMs: 2300 });
  });

  it("speaks a sentence with no audio line through the browser voice", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    const s = t.requests[0]!.stream;
    s.push({ type: "sentence", turnIndex: 0, sentenceIndex: 0, text: "No audio here." });
    s.push({ type: "sentence", turnIndex: 0, sentenceIndex: 1, text: "This one has audio." });
    s.push({ type: "audio", turnIndex: 0, sentenceIndex: 1, url: "/a/1.wav" });
    await tick();
    expect(t.pb.enqueued.map((e) => e.url)).toEqual([undefined, "/a/1.wav"]);
  });

  it("holds all sentences until their audio lines arrive, in order", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    const s = t.requests[0]!.stream;
    s.push({ type: "sentence", turnIndex: 0, sentenceIndex: 0, text: "A." });
    s.push({ type: "sentence", turnIndex: 0, sentenceIndex: 1, text: "B." });
    await tick();
    expect(t.pb.enqueued).toHaveLength(0);
    s.push({ type: "audio", turnIndex: 0, sentenceIndex: 0, url: "/a/0.wav" });
    s.push({ type: "audio", turnIndex: 0, sentenceIndex: 1, url: "/a/1.wav" });
    await tick();
    expect(t.pb.enqueued.map((e) => `${e.sentenceIndex}:${e.url}`)).toEqual(["0:/a/0.wav", "1:/a/1.wav"]);
  });

  it("in speech mode enqueues sentences at once", async () => {
    const t = setup({ tts: "speech" });
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push({ type: "sentence", turnIndex: 0, sentenceIndex: 0, text: "Hello." });
    await tick();
    expect(t.pb.enqueued).toHaveLength(1);
    expect(t.pb.enqueued[0]!.url).toBeUndefined();
  });

  it("shows an error line and retries the same request", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push({ type: "error", stage: "llm", message: "model down" });
    await tick();
    expect(t.loop.snapshot()).toMatchObject({ phase: "error", error: { stage: "llm", message: "model down" } });
    t.loop.retry();
    await tick();
    expect(t.requests).toHaveLength(2);
    expect(t.requests[1]!.req.meta).toEqual(t.requests[0]!.req.meta);
    expect(t.loop.snapshot().error).toBeNull();
  });

  it("keeps listening after an empty transcript", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "Q."));
    await tick();
    t.pb.audible(0);
    t.pb.finish();
    t.loop.onUtterance({ wav, speechStartMs: 100, speechEndMs: 600 });
    await tick();
    t.requests[1]!.stream.push({ type: "transcript", turnIndex: 1, text: "", sttMs: 100 });
    t.requests[1]!.stream.end();
    await tick();
    expect(t.loop.snapshot().phase).toBe("listening");
    expect(t.loop.snapshot().candidateTurns).toBe(0);
    t.clock.advance(8000);
    await tick();
    expect(t.requests[2]!.req.meta.kind).toBe("silence_prompt");
  });

  it("treats a stream that ends without done as an error", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.end();
    await tick();
    expect(t.loop.snapshot().phase).toBe("error");
  });

  it("ends the session after the closing line has played", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "Thank you.", true));
    await tick();
    t.pb.audible(0);
    expect(t.ended).toHaveLength(0);
    t.pb.finish();
    await tick();
    expect(t.endPrev).toHaveLength(1);
    expect(t.ended).toHaveLength(1);
    expect(t.loop.snapshot().phase).toBe("ended");
  });

  it("End stops playback and posts end once", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "Q."));
    await tick();
    t.pb.audible(0);
    await t.loop.end();
    await t.loop.end();
    expect(t.pb.stops).toBe(1);
    expect(t.endPrev).toHaveLength(1);
    expect(t.ended).toHaveLength(1);
  });

  it("test_pause_sends_the_audio_ahead_but_not_when_muted_or_idle", async () => {
    const t = setup();
    t.loop.onPause({ wav }); // idle: nothing started yet
    expect(t.ahead).toHaveLength(0);
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "First question."));
    await tick();
    t.pb.audible(0);
    t.pb.finish();
    t.loop.onPause({ wav });
    expect(t.ahead).toEqual([wav]);
    t.loop.setMuted(true);
    t.loop.onPause({ wav });
    expect(t.ahead).toHaveLength(1);
  });

  it("test_stage_marks_are_sent_with_the_next_request", async () => {
    const t = setup();
    t.loop.start();
    await tick();
    t.requests[0]!.stream.push(...t.turn(0, "First question."));
    await tick();
    t.pb.audible(0);
    t.pb.finish();
    // The candidate answers: speech ended 1200 ms before the utterance arrives.
    t.clock.advance(5000);
    const endMs = t.clock.now() - 1000 - 1200; // on the session clock
    t.clock.advance(0);
    t.loop.onUtterance({ wav, speechStartMs: endMs - 3000, speechEndMs: endMs });
    await tick();
    t.clock.advance(300);
    t.requests[1]!.stream.push({ type: "transcript", turnIndex: 1, text: "I did this." });
    await tick();
    t.clock.advance(400);
    t.requests[1]!.stream.push({ type: "sentence", turnIndex: 2, sentenceIndex: 0, text: "Tell me more." });
    await tick();
    t.clock.advance(200);
    t.requests[1]!.stream.push({ type: "audio", turnIndex: 2, sentenceIndex: 0, url: "/a/2.wav" }, { type: "done", turnIndex: 2, closing: false });
    await tick();
    t.clock.advance(100);
    t.pb.audible(2);
    t.pb.finish();
    t.clock.advance(8000);
    await tick();
    const prev = t.requests[2]!.req.meta.prev;
    expect(prev?.turnIndex).toBe(2);
    expect(prev?.clientStages).toMatchObject({ detectedMs: 1200, sentMs: 1200, firstLineMs: 1500, sentenceMs: 1900, audioLineMs: 2100, audibleMs: 2200 });
  });
});
