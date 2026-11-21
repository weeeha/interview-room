// Where the gap goes (AC-6): median seconds per stage over the answered turns of saved sessions.
// Usage: npx tsx scripts/stage-table.ts <session.json> [more session.json ...] [--eos 1200]
// Needs sessions recorded with the profiling marks (turn.stages): server marks count from the moment the
// turn request arrived, browser marks from the candidate's detected end of speech. A stage is the difference
// of two marks on the same clock. The browser and server clocks are never subtracted from each other.
import { readFileSync } from "node:fs";
import type { Session, Turn } from "../shared/types.ts";
import { median, percentile } from "./latency-table.ts";

const args = process.argv.slice(2);
const eosAt = args.indexOf("--eos");
const eos = eosAt >= 0 ? Number(args[eosAt + 1]) : 1200;
const files = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--eos");
if (files.length === 0) throw new Error("Pass at least one session.json.");

type Marks = Record<string, number | undefined>;
type Row = { gap: number; model: boolean; stages: Record<string, number> };
const rows: Row[] = [];
let interruptedSkipped = 0;

for (const f of files) {
  const s = JSON.parse(readFileSync(f, "utf8")) as Session;
  s.turns.forEach((t: Turn, i) => {
    if (t.role !== "interviewer" || s.turns[i - 1]?.role !== "candidate") return;
    const gap = t.latency?.gapMs;
    const srv = (t.stages?.server ?? {}) as Marks;
    const cli = (t.stages?.client ?? {}) as Marks;
    if (typeof gap !== "number") return;
    if (t.interrupted) {
      interruptedSkipped++;
      return;
    }
    const need = [srv.sttDoneMs, srv.firstSentenceMs, srv.audioLineMs, srv.startMs, cli.detectedMs, cli.firstLineMs, cli.audioLineMs, cli.decodedMs, cli.audibleMs];
    if (need.some((v) => typeof v !== "number")) return;
    const [sttDone, firstSentence, audioLine, start, detected, firstLine, cAudioLine, decoded, audible] = need as [number, number, number, number, number, number, number, number, number];
    const model = typeof srv.llmFirstTokenMs === "number";
    const st: Record<string, number> = {};
    st["1 end-of-speech wait and WAV encode"] = detected;
    st["2 upload and request overhead"] = firstLine - detected - sttDone;
    st["3 server queue and body parse"] = start;
    st["4 speech to text"] = sttDone - start;
    if (model) {
      st["5 after STT to first model token"] = (srv.llmFirstTokenMs as number) - sttDone;
      st["6 first token to first sentence done"] = firstSentence - (srv.llmFirstTokenMs as number);
    } else {
      st["5 after STT to first model token"] = 0;
      st["6 first token to first sentence done"] = firstSentence - sttDone;
    }
    st["7 text to speech and audio line sent"] = audioLine - firstSentence;
    st["8 audio line on the wire to the page"] = cAudioLine - firstLine - (audioLine - sttDone);
    st["9 fetch and decode"] = decoded - cAudioLine;
    st["10 decoded to first audible sample"] = audible - decoded;
    rows.push({ gap, model, stages: st });
  });
}

const fmt = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "-" : String(Math.round(v)));
function table(label: string, rs: Row[]) {
  console.log(`\n${label}: n=${rs.length}`);
  if (rs.length === 0) return;
  const gaps = rs.map((r) => r.gap);
  console.log(`gap total (browser): median=${fmt(median(gaps))} p95=${fmt(percentile(gaps, 95))} max=${fmt(Math.max(...gaps))}`);
  const names = Object.keys(rs[0]!.stages);
  let sum = 0;
  for (const n of names) {
    const xs = rs.map((r) => r.stages[n] as number);
    const m = median(xs) ?? 0;
    sum += m;
    console.log(`  ${n.padEnd(42)} median=${fmt(m).padStart(5)} p95=${fmt(percentile(xs, 95)).padStart(5)}`);
  }
  console.log(`  sum of stage medians = ${fmt(sum)} (gap median ${fmt(median(gaps))}; stages are medians so they need not add up exactly)`);
}
console.log(`end-of-speech window assumed ${eos} ms; ${rows.length} answered turns used, ${interruptedSkipped} interrupted skipped`);
table("all replies", rows);
table("replies with a model call", rows.filter((r) => r.model));
table("replies from the bank (no model call)", rows.filter((r) => !r.model));
