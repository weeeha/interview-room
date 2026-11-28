// Usage: npx tsx scripts/latency-table.ts <path to session.json>
// Prints one row per interviewer turn and the median and 95th percentile of the gap.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Session, Turn } from "../shared/types.ts";

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/** Nearest-rank percentile. */
export function percentile(xs: number[], p: number): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

type Lat = { sttMs?: number; llmFirstTokenMs?: number; ttsFirstAudioMs?: number; gapMs?: number };
const lat = (t: Turn): Lat => (t.latency ?? {}) as Lat;
const nums = (turns: Turn[], k: keyof Lat) => turns.map((t) => lat(t)[k]).filter((v): v is number => typeof v === "number");
const cell = (v: number | undefined, w = 7) => (v === undefined ? "-" : String(Math.round(v))).padStart(w);

export function buildTable(session: Session): string {
  const turns = session.turns;
  const iv = turns.filter((t) => t.role === "interviewer");
  const out: string[] = [];
  out.push(`session ${session.id}  providers stt=${session.providers.stt} llm=${session.providers.llm} tts=${session.providers.tts}`);
  out.push("");
  out.push(["turn", "kind".padEnd(9), "sttMs".padStart(7), "llm1st".padStart(7), "tts1st".padStart(7), "gapMs".padStart(7), "stopMs".padStart(7), "interrupted"].join(" "));
  turns.forEach((t, i) => {
    if (t.role !== "interviewer") return;
    const l = lat(t);
    // How long the interviewer kept talking after the candidate started to speak.
    const next = turns[i + 1];
    const stop = t.interrupted && next?.role === "candidate" ? t.endMs - next.startMs : undefined;
    out.push(
      [String(t.index).padStart(4), t.kind.padEnd(9), cell(l.sttMs), cell(l.llmFirstTokenMs), cell(l.ttsFirstAudioMs), cell(l.gapMs), cell(stop), t.interrupted ? "yes" : ""].join(" "),
    );
  });
  out.push("");
  const gaps = nums(iv, "gapMs");
  if (gaps.length === 0) out.push("gapMs: no gap data");
  else out.push(`gapMs: n=${gaps.length} median=${Math.round(median(gaps) as number)} p95=${Math.round(percentile(gaps, 95) as number)}`);
  for (const [label, key] of [["sttMs", "sttMs"], ["llmFirstTokenMs", "llmFirstTokenMs"], ["ttsFirstAudioMs", "ttsFirstAudioMs"]] as const) {
    const v = nums(iv, key);
    out.push(v.length ? `${label}: n=${v.length} median=${Math.round(median(v) as number)}` : `${label}: no data`);
  }
  out.push(`interrupted turns: ${iv.filter((t) => t.interrupted).length}`);
  return out.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const file = process.argv[2];
  if (!file) throw new Error("Pass the path to a session.json.");
  console.log(buildTable(JSON.parse(readFileSync(file, "utf8")) as Session));
}
