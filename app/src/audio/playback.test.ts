import { describe, expect, it } from "vitest";
import { chunkForSpeech, createPlayback, partialText, pickVoice, rmsLevel } from "./playback.ts";

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  connect() {}
  disconnect() {}
  start() { this.started = true; }
  stop() { this.stopped = true; }
  end() { this.onended?.(); }
}

function setup(opts: { speechVoices?: number } = {}) {
  const sources: FakeSource[] = [];
  const clock = { audio: 0, wall: 0 };
  const durations = new Map<string, number>();
  const ctx = {
    get currentTime() { return clock.audio; },
    state: "running",
    destination: {},
    createGain: () => ({ connect() {} }),
    createAnalyser: () => ({ fftSize: 0, connect() {}, getByteTimeDomainData(a: Uint8Array) { a.fill(128); } }),
    createBufferSource: () => { const s = new FakeSource(); sources.push(s); return s; },
    decodeAudioData(data: ArrayBuffer, ok: (b: unknown) => void, bad: (e: unknown) => void) {
      const id = new TextDecoder().decode(data);
      if (id === "bad") bad(new Error("decode"));
      else ok({ duration: durations.get(id) ?? 1 });
    },
  };
  const spoken: Array<{ text: string; u: Record<string, unknown> }> = [];
  let cancelled = 0;
  const voices = opts.speechVoices === 0 ? [] : [{ name: "Samantha", lang: "en-US" }];
  const speech = {
    speak(u: Record<string, unknown>) { spoken.push({ text: String(u.text), u }); },
    cancel() { cancelled++; },
    getVoices: () => voices,
  };
  const fetchImpl = (async (url: string) => {
    if (url.includes("404")) return new Response("", { status: 404 });
    return new Response(url.includes("bad") ? "bad" : url);
  }) as unknown as typeof fetch;
  const pb = createPlayback({
    audioContext: ctx as never,
    speech: speech as never,
    createUtterance: (text) => ({ text }) as never,
    fetchImpl,
    now: () => clock.wall,
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { pb, sources, clock, durations, spoken, speech, tick, cancelled: () => cancelled };
}

describe("playback queue", () => {
  it("reports playing while the only item is still being decoded", async () => {
    const t = setup();
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "One.", url: "/a" });
    expect(t.pb.isPlaying()).toBe(true);
    await t.tick();
    await t.tick();
    expect(t.sources.length).toBe(1);
    expect(t.pb.isPlaying()).toBe(true);
  });

  it("test_plays_urls_in_order", async () => {
    const t = setup();
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "One.", url: "/a" });
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 1, text: "Two.", url: "/b" });
    await t.tick();
    expect(t.sources).toHaveLength(1); // second waits for the first
    t.sources[0]!.end();
    await t.tick();
    expect(t.sources).toHaveLength(2);
    expect(t.sources[1]!.started).toBe(true);
  });

  it("test_events_start_sentence_idle", async () => {
    const t = setup();
    const log: string[] = [];
    t.pb.onStart((e) => log.push(`start:${e.turnIndex}`));
    t.pb.onSentenceStart((e) => log.push(`sentence:${e.turnIndex}.${e.sentenceIndex}`));
    t.pb.onIdle(() => log.push("idle"));
    t.pb.enqueue({ turnIndex: 3, sentenceIndex: 0, text: "One.", url: "/a" });
    t.pb.enqueue({ turnIndex: 3, sentenceIndex: 1, text: "Two.", url: "/b" });
    await t.tick();
    t.sources[0]!.end();
    await t.tick();
    t.sources[1]!.end();
    await t.tick();
    expect(log).toEqual(["start:3", "sentence:3.0", "sentence:3.1", "idle"]);
    expect(t.pb.isPlaying()).toBe(false);
  });

  it("test_speaks_items_without_url", async () => {
    const t = setup();
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "Hello there.", });
    await t.tick();
    expect(t.spoken.map((s) => s.text)).toEqual(["Hello there."]);
    expect((t.spoken[0]!.u.voice as { name: string }).name).toBe("Samantha");
    const idle: string[] = [];
    t.pb.onIdle(() => idle.push("idle"));
    (t.spoken[0]!.u.onend as () => void)();
    await t.tick();
    expect(idle).toEqual(["idle"]);
  });

  it("test_failed_audio_falls_back_to_speech", async () => {
    const t = setup();
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "Fallback.", url: "/bad" });
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 1, text: "Missing.", url: "/404" });
    await t.tick();
    expect(t.sources).toHaveLength(0);
    expect(t.spoken.map((s) => s.text)).toEqual(["Fallback."]);
  });

  it("test_stop_silences_everything_and_reports_played", async () => {
    const t = setup();
    t.durations.set("/a", 2);
    t.durations.set("/b", 4);
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "First sentence here.", url: "/a" });
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 1, text: "one two three four five six seven eight.", url: "/b" });
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 2, text: "Never heard.", url: "/c" });
    await t.tick();
    t.clock.audio = 2;
    t.sources[0]!.end();
    await t.tick();
    t.clock.audio = 3; // 1 s into the 4 s second sentence
    const r = t.pb.stop();
    expect(t.sources[1]!.stopped).toBe(true);
    expect(t.cancelled()).toBe(1);
    expect(r.playedMs).toBe(3000);
    expect(r.spokenText).toBe("First sentence here. one two");
    expect(r.sentences.map((s) => [s.sentenceIndex, s.fraction])).toEqual([[0, 1], [1, 0.25]]);
    await t.tick();
    expect(t.sources).toHaveLength(2); // the third sentence never starts
    expect(t.pb.isPlaying()).toBe(false);
  });

  it("test_stop_does_not_fire_idle_and_queue_is_reusable", async () => {
    const t = setup();
    let idles = 0;
    t.pb.onIdle(() => idles++);
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "A.", url: "/a" });
    await t.tick();
    t.pb.stop();
    await t.tick();
    expect(idles).toBe(0);
    t.pb.enqueue({ turnIndex: 1, sentenceIndex: 0, text: "B.", url: "/b" });
    await t.tick();
    expect(t.sources).toHaveLength(2);
    expect(t.sources[1]!.started).toBe(true);
  });

  it("test_stop_during_speech_uses_boundary_fraction", async () => {
    const t = setup();
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "aa bb cc dd ee ff gg hh ii jj" });
    await t.tick();
    t.clock.wall = 1200;
    (t.spoken[0]!.u.onboundary as (e: { charIndex: number }) => void)({ charIndex: 15 });
    const r = t.pb.stop();
    expect(r.playedMs).toBe(1200);
    expect(r.spokenText).toBe("aa bb cc dd ee");
  });

  it("test_idle_after_run_resets_played_counters", async () => {
    const t = setup();
    t.pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "A.", url: "/a" });
    await t.tick();
    t.sources[0]!.end();
    await t.tick();
    expect(t.pb.stop().playedMs).toBe(0);
  });
});

describe("playback helpers", () => {
  it("test_chunk_long_text_for_speech", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkForSpeech(long, 100);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(chunks.join(" ")).toBe(long);
    expect(chunkForSpeech("Short one.")).toEqual(["Short one."]);
  });

  it("test_partial_text_by_words", () => {
    expect(partialText("a b c d", 0.5)).toBe("a b");
    expect(partialText("a b c d", 0)).toBe("");
    expect(partialText("a b c d", 1)).toBe("a b c d");
  });

  it("test_rms_level", () => {
    expect(rmsLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsLevel(new Uint8Array(64).fill(255))).toBe(1);
    expect(rmsLevel([])).toBe(0);
  });

  it("test_pick_voice_prefers_known_english", () => {
    const v = (name: string, lang: string) => ({ name, lang }) as SpeechSynthesisVoice;
    expect(pickVoice([v("Anna", "de-DE"), v("Other", "en-GB"), v("Samantha", "en-US")])?.name).toBe("Samantha");
    expect(pickVoice([v("Anna", "de-DE"), v("Other", "en-GB")])?.name).toBe("Other");
    expect(pickVoice([v("Anna", "de-DE")])).toBeUndefined();
  });

  it("test_waits_for_late_voice_list", async () => {
    const listeners: Array<() => void> = [];
    let ready = false;
    const spoken: string[] = [];
    const speech = {
      speak: (u: { text: string }) => spoken.push(u.text),
      cancel() {},
      getVoices: () => (ready ? [{ name: "Samantha", lang: "en-US" }] : []),
      addEventListener: (_t: string, cb: () => void) => listeners.push(cb),
      removeEventListener() {},
    };
    const pb = createPlayback({
      audioContext: { state: "running", destination: {}, currentTime: 0, createGain: () => ({ connect() {} }), createAnalyser: () => ({ connect() {} }) } as never,
      speech: speech as never,
      createUtterance: (text) => ({ text }) as never,
    });
    pb.enqueue({ turnIndex: 0, sentenceIndex: 0, text: "Hi." });
    await new Promise((r) => setTimeout(r, 5));
    expect(spoken).toEqual([]); // still waiting for voices
    ready = true;
    listeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r, 5));
    expect(spoken).toEqual(["Hi."]);
  });
});
