import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { QuestionBank } from "../../../shared/types.ts";
import { parseBank, slugify } from "./parse.ts";

export function bankDir(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.QUESTION_BANK_DIR || "./banks");
}

// Reads every .md file in the folder. Files are read in place and never copied.
export function loadBanks(dir: string): QuestionBank[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".md")).sort();
  } catch {
    return [];
  }
  const banks: QuestionBank[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const sourcePath = join(dir, name);
    let id = slugify(name);
    for (let n = 2; seen.has(id); n += 1) id = `${slugify(name)}-${n}`;
    seen.add(id);
    const bank = parseBank(readFileSync(sourcePath, "utf8"), { id, sourcePath });
    if (bank.questions.length > 0) banks.push(bank);
  }
  return banks;
}
