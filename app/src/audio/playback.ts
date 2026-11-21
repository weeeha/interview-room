// Interviewer voice playback. Items with a url are fetched, decoded and played through one
// GainNode (`output`). Items without a url are spoken with speechSynthesis. Items play in order.
// Audio items are decoded as soon as they are queued, so the next sentence is ready when the
// current one ends. Between two audio items the gap is one `ended` event (a few ms).

export type PlaybackItem = { turnIndex: number; sentenceIndex: number; text: string; url?: string };
export type SentenceInfo = { turnIndex: number; sentenceIndex: number; text: string };
export type StopResult = {
  playedMs: number;
  /** Fully spoken sentences, plus the spoken part of the one that was cut off. */
  spokenText: string;
  sentences: Array<SentenceInfo & { fraction: number }>;
};

export type SpeechLike = {
  speak(u: SpeechSynthesisUtterance): void;
  cancel(): void;
  getVoices(): SpeechSynthesisVoice[];
  addEventListener?(type: "voiceschanged", cb: () => void): void;
  removeEventListener?(type: "voiceschanged", cb: () => void): void;
};

export type PlaybackOptions = {
  audioContext: AudioContext;
  /** Where `output` is connected. Defaults to audioContext.destination. */
  destination?: AudioNode;
  speech?: SpeechLike | null;
  createUtterance?: (text: string) => SpeechSynthesisUtterance;
  fetchImpl?: typeof fetch;
  /** Wall clock in ms, used for speech timing and onStart timestamps. */
  now?: () => number;
};

export type Playback = {
  enqueue(item: PlaybackItem): void;
  stop(): StopResult;
  onStart(cb: (e: { turnIndex: number; atMs: number }) => void): () => void;
  onSentenceStart(cb: (e: SentenceInfo) => void): () => void;
  onIdle(cb: () => void): () => void;
  level(): number;
  output: AudioNode;
  isPlaying(): boolean;
};

/** Chrome cuts off speech utterances that run past about 15 s, so long text is spoken in chunks. */
export const MAX_UTTERANCE_CHARS = 160;
const VOICE_WAIT_MS = 1500;
const PREFERRED_VOICES = ["Samantha", "Google US English", "Microsoft Aria", "Microsoft Jenny", "Daniel", "Karen"];

export function chunkForSpeech(text: string, max = MAX_UTTERANCE_CHARS): string[] {
  const out: string[] = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = Math.max(rest.lastIndexOf(", ", max), rest.lastIndexOf("; ", max), rest.lastIndexOf(": ", max));
    if (cut < max / 3) cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/** The first `fraction` of the words of `text`. */
export function partialText(text: string, fraction: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  const n = Math.floor(words.length * Math.min(1, Math.max(0, fraction)));
  return words.slice(0, n).join(" ");
}

/** 0 to 1 level from unsigned 8-bit time-domain samples (128 is silence). */
export function rmsLevel(bytes: ArrayLike<number>): number {
  if (bytes.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) {
    const v = ((bytes[i] ?? 128) - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / bytes.length) * 3);
}

export function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  for (const name of PREFERRED_VOICES) {
    const hit = en.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return en.find((v) => /^en[-_]US/i.test(v.lang)) ?? en[0];
}

type Entry = { item: PlaybackItem; decoded: Promise<AudioBuffer | null> };
type Active = { item: PlaybackItem; kind: "audio" | "speech"; startedAt: number; durationMs: number; boundaryFraction?: number; source?: AudioBufferSourceNode };

export function createPlayback(opts: PlaybackOptions): Playback {
  const ctx = opts.audioContext;
  const now = opts.now ?? (() => performance.now());
  const speech = opts.speech === undefined ? (typeof speechSynthesis === "undefined" ? null : speechSynthesis) : opts.speech;
  const makeUtterance = opts.createUtterance ?? ((t: string) => new SpeechSynthesisUtterance(t));
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  const gain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  gain.connect(opts.destination ?? ctx.destination);
  gain.connect(analyser);
  const scratch = new Uint8Array(analyser.fftSize);

  const startCbs = new Set<(e: { turnIndex: number; atMs: number }) => void>();
  const sentenceCbs = new Set<(e: SentenceInfo) => void>();
  const idleCbs = new Set<() => void>();

  let queue: Entry[] = [];
  let pumping = false;
  let generation = 0;
  let lastStartedTurn = -1;
  let active: Active | null = null;
  let done: Array<{ item: PlaybackItem; playedMs: number }> = [];
  let endActive: (() => void) | null = null; // resolves the pump's wait for the active item
  let voice: Promise<SpeechSynthesisVoice | undefined> | null = null;
  const keepAlive = new Set<SpeechSynthesisUtterance>(); // Chrome drops events of a collected utterance

  const subscribe = <T>(set: Set<T>, cb: T) => {
    set.add(cb);
    return () => void set.delete(cb);
  };

  function decode(url: string): Promise<AudioBuffer | null> {
    return doFetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      // Callback form: older Safari has no promise form of decodeAudioData.
      .then((data) => new Promise<AudioBuffer>((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
      .catch(() => null);
  }

  function loadVoice(): Promise<SpeechSynthesisVoice | undefined> {
    if (!speech) return Promise.resolve(undefined);
    voice ??= new Promise((resolve) => {
      const first = speech.getVoices();
      if (first.length > 0) return resolve(pickVoice(first));
      // Safari and Chrome fill the voice list late.
      const finish = () => {
        speech.removeEventListener?.("voiceschanged", finish);
        clearTimeout(timer);
        resolve(pickVoice(speech.getVoices()));
      };
      const timer = setTimeout(finish, VOICE_WAIT_MS);
      speech.addEventListener?.("voiceschanged", finish);
    });
    return voice;
  }

  function markStart(item: PlaybackItem) {
    if (item.turnIndex !== lastStartedTurn) {
      lastStartedTurn = item.turnIndex;
      for (const cb of startCbs) cb({ turnIndex: item.turnIndex, atMs: now() });
    }
    for (const cb of sentenceCbs) cb({ turnIndex: item.turnIndex, sentenceIndex: item.sentenceIndex, text: item.text });
  }

  function playBuffer(item: PlaybackItem, buf: AudioBuffer, gen: number): Promise<void> {
    return new Promise((resolve) => {
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.connect(gain);
      const a: Active = { item, kind: "audio", startedAt: ctx.currentTime, durationMs: buf.duration * 1000, source };
      active = a;
      const finish = () => {
        source.onended = null;
        endActive = null;
        if (gen === generation) {
          done.push({ item, playedMs: a.durationMs });
          active = null;
        }
        resolve();
      };
      endActive = finish;
      source.onended = finish;
      if (ctx.state === "suspended") void ctx.resume();
      source.start();
      markStart(item);
    });
  }

  async function speakItem(item: PlaybackItem, gen: number): Promise<void> {
    if (!speech) return; // no way to speak: skip the sentence
    const chosen = await loadVoice();
    if (gen !== generation) return;
    const chunks = chunkForSpeech(item.text);
    const a: Active = { item, kind: "speech", startedAt: now(), durationMs: 0, boundaryFraction: 0 };
    active = a;
    let offset = 0;
    for (const chunk of chunks) {
      if (gen !== generation) return;
      await new Promise<void>((resolve) => {
        const u = makeUtterance(chunk);
        u.lang = chosen?.lang ?? "en-US";
        if (chosen) u.voice = chosen;
        u.rate = 1;
        const base = offset;
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(safety);
          keepAlive.delete(u);
          endActive = null;
          resolve();
        };
        endActive = finish;
        u.onstart = () => {
          if (gen !== generation) return;
          if (base === 0) {
            a.startedAt = now();
            markStart(item);
          }
        };
        u.onboundary = (e) => {
          if (gen === generation) a.boundaryFraction = (base + e.charIndex) / Math.max(1, item.text.length);
        };
        u.onend = finish;
        u.onerror = finish;
        // Some Chrome builds drop onend, and a garbage-collected utterance never reports.
        const safety = setTimeout(finish, 4000 + chunk.split(/\s+/).length * 600);
        keepAlive.add(u);
        speech.speak(u);
      });
      offset += chunk.length + 1;
    }
    if (gen === generation) {
      done.push({ item, playedMs: now() - a.startedAt });
      active = null;
    }
  }

  async function pump() {
    if (pumping) return;
    pumping = true;
    const gen = generation;
    try {
      while (queue.length > 0 && gen === generation) {
        const entry = queue.shift()!;
        const buf = entry.item.url ? await entry.decoded : null;
        if (gen !== generation) return;
        if (buf) await playBuffer(entry.item, buf, gen);
        else await speakItem(entry.item, gen); // no url, or the audio failed to load
      }
    } finally {
      if (gen === generation) {
        pumping = false;
        if (queue.length === 0 && !active) {
          done = [];
          for (const cb of idleCbs) cb();
        } else if (queue.length > 0) void pump();
      }
    }
  }

  return {
    enqueue(item) {
      queue.push({ item, decoded: item.url ? decode(item.url) : Promise.resolve(null) });
      if (ctx.state === "suspended") void ctx.resume();
      void pump();
    },

    stop() {
      const sentences: StopResult["sentences"] = done.map((d) => ({
        turnIndex: d.item.turnIndex,
        sentenceIndex: d.item.sentenceIndex,
        text: d.item.text,
        fraction: 1,
      }));
      let playedMs = done.reduce((s, d) => s + d.playedMs, 0);
      const spoken = done.map((d) => d.item.text);
      if (active) {
        const a = active;
        const elapsed = a.kind === "audio" ? Math.min(a.durationMs, (ctx.currentTime - a.startedAt) * 1000) : now() - a.startedAt;
        const fraction =
          a.kind === "audio"
            ? a.durationMs > 0 ? elapsed / a.durationMs : 0
            : (a.boundaryFraction ?? 0) > 0 ? a.boundaryFraction! : Math.min(0.95, elapsed / Math.max(1, a.item.text.split(/\s+/).length * 400));
        playedMs += Math.max(0, elapsed);
        const part = partialText(a.item.text, fraction);
        if (part) {
          spoken.push(part);
          sentences.push({ turnIndex: a.item.turnIndex, sentenceIndex: a.item.sentenceIndex, text: a.item.text, fraction });
        }
        if (a.source) {
          a.source.onended = null;
          try { a.source.stop(); } catch { /* already stopped */ }
          try { a.source.disconnect(); } catch { /* already disconnected */ }
        }
      }
      generation++;
      speech?.cancel();
      queue = [];
      active = null;
      done = [];
      pumping = false;
      const release = endActive;
      endActive = null;
      release?.(); // let the old pump loop exit; it sees the new generation
      return { playedMs: Math.round(playedMs), spokenText: spoken.join(" "), sentences };
    },

    onStart: (cb) => subscribe(startCbs, cb),
    onSentenceStart: (cb) => subscribe(sentenceCbs, cb),
    onIdle: (cb) => subscribe(idleCbs, cb),

    level() {
      if (active?.kind === "speech") return 0.3 + 0.2 * Math.abs(Math.sin(now() / 90)); // speechSynthesis cannot be tapped
      analyser.getByteTimeDomainData(scratch);
      return rmsLevel(scratch);
    },

    output: gain,
    isPlaying: () => active !== null || queue.length > 0,
  };
}
