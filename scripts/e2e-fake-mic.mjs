// End-to-end check of the voice loop with no human microphone.
// Builds a fake microphone WAV (macOS say + ffmpeg), starts a throwaway headless Chrome that plays it as
// the microphone, drives the app over the DevTools protocol, and prints what happened.
// Needs `npm run dev` running and the model services up. Chrome is muted, so nothing is audible.
// Usage: node scripts/e2e-fake-mic.mjs [--app http://localhost:8940] [--minutes 5] [--turns 4] [--max-sec 240] [--query 'splat=<url>']
// --query adds extra query parameters to the session page (for example a sample splat in dev). The run prints the room notice
// text and the backdrop mode the page showed, so a missing room file (AC-4) can be read from the output.
/* global process, console, fetch, WebSocket, setTimeout */
import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const APP = arg("app", "http://localhost:8940");
const LENGTH_MIN = Number(arg("minutes", "5"));
const WANT_TURNS = Number(arg("turns", "4"));
const MAX_SEC = Number(arg("max-sec", "240"));
const EXTRA_QUERY = arg("query", "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const root = resolve(import.meta.dirname, "..");
const fixtures = join(root, "media", "fixtures");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Four invented answers, each 10 to 20 seconds when spoken.
const ANSWERS = [
  "The project I am proudest of was a ticket checklist for a small bakery chain. Orders came in by phone and paper, and about one in ten was wrong. I interviewed the counter staff for two weeks, then built a tablet checklist that cut the wrong orders to one in forty within a month.",
  "Last spring I disagreed with a developer about a signup form. He wanted five steps, I wanted two. Instead of arguing I ran a quick test with ten people on both versions. The short form finished faster, and he agreed to ship it, so we kept the five step version only for business accounts.",
  "When a deadline slipped, I listed every task that was left and asked the team which three mattered most to customers. We dropped two features and moved a third to the next release. We shipped on the new date and nobody had to work the weekend, which I count as a good outcome.",
  "I learn new tools by rebuilding something small that I already understand. Last year I picked up a prototyping tool by recreating the checkout screen from an old project. It took one evening, and the mistakes I made there taught me more than any tutorial did.",
];

function run(cmd, args) {
  return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}

function buildFakeMic() {
  mkdirSync(fixtures, { recursive: true });
  const out = join(fixtures, "fake-mic-4-answers-48k.wav");
  if (existsSync(out)) return out;
  const parts = [];
  const silence = (name, sec) => {
    const f = join(fixtures, name);
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(sec), "-c:a", "pcm_s16le", f]);
    return f;
  };
  parts.push(silence("sil-lead.wav", 6));
  ANSWERS.forEach((text, i) => {
    const aiff = join(fixtures, `ans-${i + 1}.aiff`);
    const wav = join(fixtures, `ans-${i + 1}.wav`);
    run("say", ["-v", "Samantha", "-o", aiff, text]);
    run("ffmpeg", ["-y", "-i", aiff, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
    parts.push(wav, silence(`sil-${i + 1}.wav`, 14));
  });
  const list = join(fixtures, "concat.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  run("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", list, "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", out]);
  return out;
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve: ok, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else ok(msg.result);
      } else if (msg.method) for (const h of this.handlers) h(msg);
    });
  }
  open() {
    return new Promise((ok, bad) => {
      this.ws.addEventListener("open", () => ok(), { once: true });
      this.ws.addEventListener("error", () => bad(new Error("DevTools socket failed")), { once: true });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(h) {
    this.handlers.push(h);
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
    return r.result.value;
  }
}

async function waitFor(fn, what, timeoutMs, stepMs = 300) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(stepMs);
  }
}

// Counts which capture path ran and whether the browser voice was used.
const INIT_SCRIPT = `
window.__e2e = { worklet: 0, scriptProcessor: 0, speak: 0, voices: -1, errors: [] };
const AW = window.AudioWorkletNode;
if (AW) window.AudioWorkletNode = class extends AW { constructor(...a) { super(...a); window.__e2e.worklet++; } };
const csp = AudioContext.prototype.createScriptProcessor;
AudioContext.prototype.createScriptProcessor = function (...a) { window.__e2e.scriptProcessor++; return csp.apply(this, a); };
if (window.speechSynthesis) {
  const sp = speechSynthesis.speak.bind(speechSynthesis);
  speechSynthesis.speak = (u) => { window.__e2e.speak++; return sp(u); };
  window.__e2e.voices = speechSynthesis.getVoices().length;
}
`;

const out = { sessionId: null, consoleErrors: [], notes: [] };
let chrome = null;
let profile = null;

function cleanup() {
  if (chrome && chrome.exitCode === null) chrome.kill("SIGKILL");
  if (profile) rmSync(profile, { recursive: true, force: true });
  profile = null;
}
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

async function main() {
  const wav = arg("mic", null) ?? buildFakeMic();
  console.log(`fake microphone: ${wav}`);
  profile = mkdtempSync(join(tmpdir(), "interview-room-e2e-"));
  // Chrome reads the fake microphone file from a path without spaces more reliably.
  const micCopy = join(profile, "mic.wav");
  copyFileSync(wav, micCopy);
  chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--mute-audio",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${PORT}`,
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      ...(process.argv.includes("--no-file") ? [] : [`--use-file-for-fake-audio-capture=${micCopy}`]),
      "--autoplay-policy=no-user-gesture-required",
      // The audio service sandbox cannot open the fake microphone file, so the input would be silent.
      "--disable-features=AudioServiceSandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,800",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const version = await waitFor(() => fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()), "Chrome to start", 20000);
  out.chromeVersion = version.Browser;
  const targets = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
  const page = targets.find((t) => t.type === "page");
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  cdp.on((m) => {
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      out.consoleErrors.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description ?? "").join(" ")}`);
    } else if (m.method === "Runtime.exceptionThrown") {
      out.consoleErrors.push(`exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
    } else if (m.method === "Log.entryAdded" && m.params.entry.level === "error") {
      out.consoleErrors.push(`log: ${m.params.entry.text} ${m.params.entry.url ?? ""}`);
    }
  });
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Log.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: INIT_SCRIPT });
  await cdp.send("Page.navigate", { url: `${APP}/?debug=1` });

  const click = (text) =>
    cdp.eval(`(() => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(${JSON.stringify(text)}) && !x.disabled); if (!b) return false; b.click(); return true; })()`);

  await waitFor(() => cdp.eval(`!!document.querySelector('#bank') && !document.querySelector('#bank').disabled`), "the setup screen", 15000);
  await cdp.eval(`(() => { const r = [...document.querySelectorAll('input[name=length]')].find(x => x.value === '${LENGTH_MIN}'); r.click(); })()`);
  await sleep(300);
  if (!(await click("Start session"))) throw new Error("Start session button not clickable");
  await waitFor(() => cdp.eval(`location.pathname.startsWith('/session/')`), "the room route", 10000);
  out.sessionId = await cdp.eval(`location.pathname.split('/')[2]`);
  console.log(`session ${out.sessionId}`);
  // A full navigation so the debug line is on (?debug=1) and the page starts clean.
  await cdp.send("Page.navigate", { url: `${APP}/session/${out.sessionId}?debug=1${EXTRA_QUERY ? `&${EXTRA_QUERY}` : ""}` });
  await waitFor(() => cdp.eval(`[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Start')`), "the Start button", 10000);
  await waitFor(() => click("Start"), "the Start gesture button", 10000);
  const t0 = Date.now();
  // Probe: an independent analyser on the fake microphone, so a silent meter can be told apart from a dead input.
  await cdp.eval(`(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext(); await ctx.resume();
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize);
    window.__e2e.maxRms = 0;
    setInterval(() => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; window.__e2e.maxRms = Math.max(window.__e2e.maxRms, Math.sqrt(s / buf.length)); }, 50);
    return true; })()`);

  const log = async () => {
    for (let i = 0; i < 5; i++) {
      try {
        return (await fetch(`${APP}/api/session/${out.sessionId}`).then((r) => r.json())).session;
      } catch {
        await sleep(2000); // the dev server restarts when a source file changes
      }
    }
    throw new Error("session log not readable");
  };
  let session;
  for (;;) {
    session = await log();
    const cand = session.turns.filter((t) => t.role === "candidate").length;
    const sec = Math.round((Date.now() - t0) / 1000);
    const debugLine = await cdp.eval(`(document.querySelector('.status')?.textContent ?? '') + ' | ' + (document.querySelector('[data-debug]')?.textContent ?? '') + ' | maxRms ' + (window.__e2e.maxRms ?? '?') + ' | meter ' + (document.querySelector('.meter')?.dataset.level ?? '?') + ' | playing ' + (window.__room?.playback.isPlaying() ?? '?') + ' speak ' + window.__e2e.speak + ' ' + JSON.stringify(window.__room?.loop.internals())`).catch(() => "");
    console.log(`t+${sec}s candidate turns ${cand}, interviewer turns ${session.turns.filter((t) => t.role === "interviewer").length} | ${debugLine}`);
    if (cand >= WANT_TURNS || sec > MAX_SEC) break;
    await sleep(5000);
  }

  out.page = await cdp.eval(`JSON.stringify({ ...window.__e2e, status: document.querySelector('.status')?.textContent })`).then(JSON.parse);
  out.room = await cdp.eval(`JSON.stringify({ backdrop: document.body.dataset.backdrop, notice: document.querySelector('[data-room-notice]')?.textContent ?? null, webgl: !!document.createElement('canvas').getContext('webgl2'), voice: window.__room?.voice?.() ?? null, fps: [...document.querySelectorAll('[data-debug] div')].find(d => d.textContent.startsWith('fps'))?.textContent ?? null })`).then(JSON.parse);
  out.debugLine = await cdp.eval(`document.querySelector('[data-debug]')?.textContent ?? ''`);
  await click("End session");
  await waitFor(() => cdp.eval(`location.pathname.startsWith('/report/')`), "the report route after End", 20000).catch((e) =>
    out.notes.push(String(e.message)),
  );
  session = await log();
  out.turns = session.turns;
  out.status = session.status;
}

try {
  await main();
} catch (err) {
  out.notes.push(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  cleanup();
}

const turns = out.turns ?? [];
const gaps = turns.map((t) => t.latency?.gapMs).filter((g) => typeof g === "number");
const sorted = [...gaps].sort((a, b) => a - b);
console.log("\n=== result ===");
console.log(`session id: ${out.sessionId}`);
console.log(`status: ${out.status}`);
console.log(`chrome: ${out.chromeVersion}`);
console.log(`capture path: ${JSON.stringify(out.page ?? {})}`);
console.log(`room: ${JSON.stringify(out.room ?? {})}`);
console.log(`candidate turns: ${turns.filter((t) => t.role === "candidate").length}`);
console.log(`gap values (ms): ${JSON.stringify(gaps)} median ${sorted.length ? sorted[Math.floor(sorted.length / 2)] : "none"}`);
console.log(`interrupted turns: ${JSON.stringify(turns.filter((t) => t.interrupted))}`);
console.log(`console errors (${out.consoleErrors.length}):`);
for (const e of out.consoleErrors) console.log(`  ${e}`);
for (const n of out.notes) console.log(`note: ${n}`);
writeFileSync(join(fixtures, "last-e2e-run.json"), JSON.stringify(out, null, 2));
