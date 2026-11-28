// Hand-written validators for what the feedback model returns. No dependency.
import type { FeedbackReport } from "../../../shared/types.ts";

export type Note = { note: string; turnIndex: number; quote: string };
export type Score = 1 | 2 | 3 | 4;
export type Rubric = FeedbackReport["perQuestion"][number]["rubric"];
export const RUBRIC_KEYS = ["structure", "specificity", "relevance", "concision"] as const;

export type QuestionOutput = {
  strengths: Note[];
  gaps: Note[];
  rubric: Rubric;
  reasons: Record<(typeof RUBRIC_KEYS)[number], string>;
  rewrite?: string;
};
export type SummaryOutput = { summary: string; nextDrill: string[] };
export type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/** Pull a JSON object out of model text: tolerates code fences and prose before or after. */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1]! : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found in the reply");
  return JSON.parse(body.slice(start, end + 1));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function checkNotes(v: unknown, name: string, errors: string[]): Note[] {
  if (!Array.isArray(v)) {
    errors.push(`${name} must be an array`);
    return [];
  }
  const out: Note[] = [];
  v.forEach((n, i) => {
    if (!isObj(n)) return void errors.push(`${name}[${i}] must be an object`);
    if (!str(n.note)) errors.push(`${name}[${i}].note must be a non-empty string`);
    if (typeof n.turnIndex !== "number" || !Number.isInteger(n.turnIndex)) errors.push(`${name}[${i}].turnIndex must be an integer`);
    if (!str(n.quote)) errors.push(`${name}[${i}].quote must be a non-empty string`);
    if (str(n.note) && typeof n.turnIndex === "number" && str(n.quote)) out.push({ note: n.note.trim(), turnIndex: n.turnIndex, quote: n.quote.trim() });
  });
  return out;
}

export function checkQuestionOutput(raw: unknown, opts: { wantRewrite: boolean }): Checked<QuestionOutput> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["the reply must be a JSON object"] };
  const strengths = checkNotes(raw.strengths, "strengths", errors);
  const gaps = checkNotes(raw.gaps, "gaps", errors);
  const rubric = {} as Record<string, Score>;
  const reasons = {} as Record<string, string>;
  if (!isObj(raw.rubric)) errors.push("rubric must be an object");
  for (const k of RUBRIC_KEYS) {
    const s = isObj(raw.rubric) ? raw.rubric[k] : undefined;
    if (s === 1 || s === 2 || s === 3 || s === 4) rubric[k] = s;
    else if (isObj(raw.rubric)) errors.push(`rubric.${k} must be 1, 2, 3 or 4`);
    const r = isObj(raw.reasons) ? raw.reasons[k] : undefined;
    reasons[k] = str(r) ? r.trim() : "";
  }
  let rewrite: string | undefined;
  if (opts.wantRewrite && raw.rewrite !== undefined && raw.rewrite !== null) {
    if (str(raw.rewrite)) rewrite = raw.rewrite.trim();
    else errors.push("rewrite must be a non-empty string");
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { strengths, gaps, rubric: rubric as Rubric, reasons: reasons as QuestionOutput["reasons"], rewrite } };
}

export function checkSummaryOutput(raw: unknown): Checked<SummaryOutput> {
  const errors: string[] = [];
  if (!isObj(raw)) return { ok: false, errors: ["the reply must be a JSON object"] };
  if (!str(raw.summary)) errors.push("summary must be a non-empty string");
  const drills = Array.isArray(raw.nextDrill) ? raw.nextDrill.filter(str) : [];
  if (!Array.isArray(raw.nextDrill) || drills.length === 0) errors.push("nextDrill must be an array of non-empty strings");
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { summary: (raw.summary as string).trim(), nextDrill: drills.map((d) => d.trim()) } };
}
