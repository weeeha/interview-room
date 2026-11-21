// Real-provider check without a microphone.
// Usage: npx tsx scripts/scripted-session.ts   (the server must be running; SERVER_URL defaults to http://127.0.0.1:8941)
// Env: TARGET_SEC (default 180), PACE_SEC (default 0, pause before each answer to let the clock run), BANK_ID, PROFILE_ID.
// Candidate answers are invented and spoken with macOS `say`, then converted to 16 kHz mono WAV with ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "../shared/types.ts";

const SERVER = process.env.SERVER_URL || "http://127.0.0.1:8941";
const TARGET = Number(process.env.TARGET_SEC || 180);
const PACE = Number(process.env.PACE_SEC || 0);

// Invented answers. Each carries a distinctive claim a follow-up can pick up.
const ANSWERS = [
  "I led a redesign of a bakery ordering app. People abandoned the cart at the delivery slot step, so I cut the slot picker from three screens to one and tested it with seven customers. Completion went from forty eight to sixty six percent in a month.",
  "The hardest part was the owner, who wanted a loyalty banner on every screen. I showed her a heat map where people tapped past it, and we agreed to keep it only on the confirmation page.",
  "I start with the assumption that would hurt most if wrong. For the bakery it was that people knew their pickup time, so I designed the time picker first and the menu second.",
  "A stakeholder once ranked the loyalty banner first. I put both orders on one page with the cost of being wrong next to each, and we talked about it for twenty minutes instead of arguing.",
  "I disagreed with an engineer who wanted to drop the loading state to save a week. I showed him recordings of people tapping twice without it, and we shipped a plain skeleton screen on the original date.",
  "If the date had moved I would have shipped the skeleton on the order screen only, because that is where the double taps happened, and left the rest for the next release.",
  "For quick tests I use five people and one task each. I watch for hesitation and I write the three biggest problems the same day, usually in a shared note with screenshots.",
  "I pick the five from the last month of support tickets, so they have a real problem with the product. I skip anyone who works with the team.",
  "With no budget I read support tickets and send a four question survey to existing customers. I say in the readout that it is a thin sample.",
  "Research changed my plan once when interviews showed that most customers ordered for an office, not for themselves, so I moved the group order button to the top.",
];

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: "ignore" });
}

function synth(text: string, dir: string, n: number): Buffer {
  const aiff = join(dir, `a${n}.aiff`);
  const wav = join(dir, `a${n}.wav`);
  run("say", ["-v", "Samantha", "-o", aiff, text]);
  run("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav]);
  return readFileSync(wav);
}

type Line = { type: string; [k: string]: unknown };

type TurnResult = { lines: Line[]; firstAudioMs?: number; firstSentenceMs?: number; totalMs: number; done?: Line };

async function postTurn(id: string, meta: object, wav?: Buffer): Promise<TurnResult> {
  const form = new FormData();
  form.set("meta", JSON.stringify(meta));
  if (wav) form.set("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "answer.wav");
  const t0 = performance.now();
  const res = await fetch(`${SERVER}/api/session/${id}/turn`, { method: "POST", body: form });
  if (!res.ok || !res.body) throw new Error(`turn failed: ${res.status} ${await res.text()}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const out: TurnResult = { lines: [], totalMs: 0 };
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const p of parts.filter(Boolean)) {
      const line = JSON.parse(p) as Line;
      out.lines.push(line);
      const t = performance.now() - t0;
      if (line.type === "sentence") out.firstSentenceMs ??= t;
      if (line.type === "audio") out.firstAudioMs ??= t;
      if (line.type === "done") out.done = line;
      if (line.type === "error") throw new Error(`server error: ${JSON.stringify(line)}`);
    }
  }
  out.totalMs = performance.now() - t0;
  return out;
}

const say = (r: TurnResult) => r.lines.filter((l) => l.type === "sentence").map((l) => l.text as string).join(" ");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const dir = mkdtempSync(join(tmpdir(), "scripted-session-"));
const created = await fetch(`${SERVER}/api/session`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    roomId: "interview-office",
    bankId: process.env.BANK_ID || "sample-bank",
    profileId: process.env.PROFILE_ID || "neutral",
    targetDurationSec: TARGET,
  }),
});
if (!created.ok) throw new Error(`create failed: ${created.status} ${await created.text()}`);
const { session } = (await created.json()) as { session: Session };
const sessionT0 = Date.now();
console.log(`session ${session.id}, target ${TARGET}s, sessions folder: sessions/${session.id}/`);

const rows: string[] = [];
const spoken: string[] = [];
const row = (label: string, r: TurnResult, gap?: number) => {
  const d = r.done as { latency?: { sttMs: number; llmFirstTokenMs: number } } | undefined;
  rows.push(
    `${label.padEnd(18)} stt=${String(d?.latency?.sttMs ?? "-").padStart(5)}  llm1st=${String(d?.latency?.llmFirstTokenMs ?? "-").padStart(5)}  firstSentence=${String(Math.round(r.firstSentenceMs ?? 0)).padStart(5)}  firstAudio=${String(Math.round(r.firstAudioMs ?? 0)).padStart(5)}  total=${String(Math.round(r.totalMs)).padStart(5)}${gap !== undefined ? `  gap=${Math.round(gap)}` : ""}`,
  );
};

let r = await postTurn(session.id, { kind: "start" });
row("start", r);
spoken.push(`[turn ${(r.done as Line).turnIndex}] ${say(r)}`);
let prev = { turnIndex: (r.done as Line).turnIndex as number, ttsFirstAudioMs: r.firstAudioMs, gapMs: r.firstAudioMs };
let closing = Boolean((r.done as Line).closing);
let silenceDone = false;
let interruptDone = false;

for (let i = 0; i < ANSWERS.length && !closing; i++) {
  if (PACE > 0) await sleep(PACE * 1000);
  if (i === 2 && !silenceDone) {
    silenceDone = true;
    const s = await postTurn(session.id, { kind: "silence_prompt", prev });
    row("silence_prompt", s);
    spoken.push(`[turn ${(s.done as Line).turnIndex}] ${say(s)}`);
    prev = { turnIndex: (s.done as Line).turnIndex as number, ttsFirstAudioMs: s.firstAudioMs, gapMs: s.firstAudioMs };
  }
  const wav = synth(ANSWERS[i] as string, dir, i);
  let meta: Record<string, unknown> = { kind: "answer", prev };
  if (i === 3 && !interruptDone) {
    // The candidate talks over the previous interviewer line: report it as cut off after its first sentence.
    interruptDone = true;
    const first = spoken[spoken.length - 1]?.replace(/^\[turn \d+\] /, "").split(/(?<=[.?])\s/)[0] ?? "";
    // No speaker here, so the stop time is simulated: 180 ms after the candidate starts to speak.
    const startMs = Date.now() - sessionT0;
    meta = { kind: "answer", speechStartMs: startMs, prev: { ...prev, interrupted: true, interruptStopMs: startMs + 180, spokenText: first } };
    console.log(`(turn ${prev.turnIndex} reported as interrupted after: "${first}")`);
  }
  r = await postTurn(session.id, meta, wav);
  const tr = r.lines.find((l) => l.type === "transcript") as Line | undefined;
  console.log(`candidate said: ${ANSWERS[i]}`);
  console.log(`  heard: ${String(tr?.text ?? "")}`);
  // Approximation of the browser gap: the request is sent right after the end of speech, so time to first audio.
  row(`answer ${i + 1}`, r, r.firstAudioMs);
  if (!r.done) {
    console.log("  (no reply: empty transcript)");
    continue;
  }
  spoken.push(`[turn ${(r.done as Line).turnIndex}] ${say(r)}`);
  prev = { turnIndex: (r.done as Line).turnIndex as number, ttsFirstAudioMs: r.firstAudioMs, gapMs: r.firstAudioMs };
  closing = Boolean((r.done as Line).closing);
}

await fetch(`${SERVER}/api/session/${session.id}/end`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ prev }),
});

console.log("\nInterviewer lines:");
for (const s of spoken) console.log(s);
console.log(`\nClosing line reached: ${closing}`);
console.log("\nPer-turn server latencies (ms):");
for (const l of rows) console.log(l);
console.log(`\nLatency table: npx tsx scripts/latency-table.ts sessions/${session.id}/session.json`);
