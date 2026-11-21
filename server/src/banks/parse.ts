import type { Question, QuestionBank } from "../../../shared/types.ts";

// A question heading: level 3, a number (N or N.N, optional trailing dot), then the text, quoted or not.
const HEADING = /^###\s+(\d+(?:\.\d+)?)\.?\s+(\S.*?)\s*$/;
const INCLUDE = /\{\{[^}]*\}\}/g;
const EMOJI = /[\p{Extended_Pictographic}️‍]/gu;
const WARNING = /⚠/;

type FieldKey = "say" | "follow-up" | "guard" | "other";
type Field = { key: FieldKey; qualifier: string; lines: string[] };

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "bank";
}

export function clean(text: string): string {
  return text
    .replace(INCLUDE, "")
    .replace(/\*\*|__/g, "")
    .replace(EMOJI, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .trim();
}

function keyOf(name: string): FieldKey {
  const m = /^(say|follow-up|guard)\b/i.exec(name.trim());
  return m ? (m[1]!.toLowerCase() as FieldKey) : "other";
}

// Returns a field start, or null when the line is not a label line.
function labelOf(line: string): { key: FieldKey; qualifier: string; rest: string } | null {
  const bold = /^\*\*([A-Za-z][^*]*)\*\*(.*)$/.exec(line);
  if (bold) {
    const inner = bold[1]!.trim();
    const key = keyOf(inner);
    if (key === "other") return { key, qualifier: "", rest: "" };
    const after = inner.replace(/^(say|follow-up|guard)/i, "");
    const qualifier = after.replace(/^[\s,:]+/, "").replace(/[\s:]+$/, "");
    return { key, qualifier, rest: bold[2]!.replace(/^\s+/, "") };
  }
  const plain = /^(Say|Follow-up|Guard):\s*(.*)$/i.exec(line);
  if (plain) return { key: keyOf(plain[1]!), qualifier: "", rest: plain[2]! };
  return null;
}

function fieldText(f: Field): string {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const raw of f.lines) {
    const line = clean(raw);
    if (line === "") {
      if (current.length) paragraphs.push(current.join(" "));
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n");
}

function buildQuestion(
  bankId: string,
  number: string,
  rawText: string,
  body: string[],
  tags: string[],
  usedIds: Set<string>,
): Question {
  const fields: Field[] = [];
  let open: Field | null = null;
  for (const line of body) {
    const trimmed = line.trim();
    if (/^-{3,}$/.test(trimmed)) {
      open = null;
      continue;
    }
    const label = labelOf(trimmed);
    if (label) {
      open = { key: label.key, qualifier: label.qualifier, lines: [label.rest] };
      fields.push(open);
    } else if (open) {
      open.lines.push(line);
    }
  }

  const say = fields.filter((f) => f.key === "say");
  const sayWarned = say.some((f) => WARNING.test(f.lines.join(" ")) || WARNING.test(f.qualifier));
  const answer = sayWarned ? "" : say.map(fieldText).filter(Boolean).join("\n\n");

  const followUpHints = fields
    .filter((f) => f.key === "follow-up")
    .map((f) => {
      const body = fieldText(f);
      const q = clean(f.qualifier);
      return q && body ? `${q}: ${body}` : q || body;
    })
    .filter(Boolean);
  const doNotSay = fields
    .filter((f) => f.key === "guard")
    .map((f) => fieldText(f).replace(/\s*\n\n\s*/g, " "))
    .filter(Boolean);

  let id = `${bankId}-q${number}`;
  for (let n = 2; usedIds.has(id); n += 1) id = `${bankId}-q${number}-${n}`;
  usedIds.add(id);

  const question: Question = {
    id,
    text: clean(rawText),
    followUpHints,
    doNotSay,
    tags: [...tags],
    hasReferenceAnswer: answer !== "",
  };
  if (answer !== "") question.referenceAnswer = answer;
  return question;
}

export function parseBank(markdown: string, opts: { id: string; sourcePath: string }): QuestionBank {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const questions: Question[] = [];
  const usedIds = new Set<string>();
  let title = "";
  let section = "";
  let current: { number: string; text: string; body: string[]; tags: string[] } | null = null;

  const flush = () => {
    if (current) questions.push(buildQuestion(opts.id, current.number, current.text, current.body, current.tags, usedIds));
    current = null;
  };

  for (const line of lines) {
    const h = HEADING.exec(line);
    if (h) {
      flush();
      const number = h[1]!.replace(".", "-");
      let text = h[2]!;
      // A quoted heading may list alternate wordings as "A" / "B": the first one is the question.
      if (text.startsWith('"')) text = text.slice(1).split(/"\s*\/\s*"/)[0]!.replace(/"\s*$/, "");
      current = { number, text, body: [], tags: section ? [section] : [] };
      continue;
    }
    const h1 = /^#\s+(.+)$/.exec(line);
    const h2 = /^##\s+(.+)$/.exec(line);
    if (h1 || h2 || /^###\s/.test(line)) flush();
    if (h1 && !title) title = clean(h1[1]!);
    else if (h2) section = clean(h2[1]!);
    else if (current) current.body.push(line);
  }
  flush();

  return { id: opts.id, title: title || opts.id, sourcePath: opts.sourcePath, questions };
}
