// Breakdown of the gap (AC-6) and the stop time (AC-7) for one saved session.
// Usage: npx tsx scripts/acceptance-stats.ts <path to session.json> [endOfSpeechMs, default 1200]
// A "response gap" is the gapMs of an interviewer turn that answers a candidate turn (kinds question, followup, closing).
// Silence prompts and offers have no gap because no candidate speech came before them.
// The browser's gap includes the end-of-speech window, so the table splits it into that window, the server steps and the rest.
import { readFileSync } from "node:fs";
import type { Session, Turn } from "../shared/types.ts";
import { median, percentile } from "./latency-table.ts";

const file = process.argv[2];
if (!file) throw new Error("Pass the path to a session.json.");
const eos = Number(process.argv[3] ?? 1200);
const session = JSON.parse(readFileSync(file, "utf8")) as Session;
const turns = session.turns;
type Lat = { sttMs?: number; llmFirstTokenMs?: number; ttsFirstAudioMs?: number; gapMs?: number };
const lat = (t: Turn): Lat => (t.latency ?? {}) as Lat;
const fmt = (v: number | undefined) => (v === undefined ? "-" : String(Math.round(v)));

const resp = turns.filter((t, i) => t.role === "interviewer" && turns[i - 1]?.role === "candidate" && typeof lat(t).gapMs === "number");
const clean = resp.filter((t) => !t.interrupted);
const stat = (label: string, xs: number[]) =>
  console.log(`${label.padEnd(34)} n=${String(xs.length).padStart(2)} median=${fmt(median(xs))} p95=${fmt(percentile(xs, 95))} max=${fmt(xs.length ? Math.max(...xs) : undefined)}`);

console.log(`session ${session.id}: ${resp.length} response gaps, ${clean.length} of them on replies that were not interrupted`);
const pick = (k: keyof Lat) => resp.map((t) => lat(t)[k]).filter((v): v is number => typeof v === "number");
stat("gapMs (all response turns)", pick("gapMs"));
stat("gapMs (replies not interrupted)", clean.map((t) => lat(t).gapMs as number));
stat("gap minus end-of-speech window", pick("gapMs").map((g) => g - eos));
stat("sttMs", pick("sttMs"));
stat("llmFirstTokenMs (0 = no model call)", pick("llmFirstTokenMs"));
const withModel = resp.filter((t) => (lat(t).llmFirstTokenMs ?? 0) > 0);
stat("llmFirstTokenMs (model turns only)", withModel.map((t) => lat(t).llmFirstTokenMs as number));
stat("ttsFirstAudioMs", pick("ttsFirstAudioMs"));
const rest = resp.map((t) => (lat(t).gapMs as number) - eos - (lat(t).sttMs ?? 0) - (lat(t).ttsFirstAudioMs ?? 0));
stat("rest = gap - eos - stt - tts1st", rest);
console.log("(rest holds the model time until the first sentence is complete, upload, decode and playback start)");

const stops: { index: number; kind: string; ms: number }[] = [];
turns.forEach((t, i) => {
  const next = turns[i + 1];
  if (t.role === "interviewer" && t.interrupted && next?.role === "candidate") stops.push({ index: t.index, kind: t.kind, ms: t.endMs - next.startMs });
});
console.log(`\ninterrupted interviewer turns: ${stops.length}`);
for (const s of stops) console.log(`  turn ${s.index} (${s.kind}): ${s.ms} ms from speech start to stop`);
if (stops.length) {
  const v = stops.map((s) => s.ms);
  console.log(`stop ms: median=${fmt(median(v))} max=${Math.max(...v)}`);
}
