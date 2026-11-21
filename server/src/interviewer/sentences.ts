const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "approx",
]);

/** Remove list markers and markdown so a line is fit to be spoken. */
export function cleanSpoken(sentence: string): string {
  return sentence
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")
    .replace(/[*_`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function endsWithAbbreviation(text: string): boolean {
  const m = /([A-Za-z.]+)\.$/.exec(text);
  if (!m) return false;
  const word = (m[1] ?? "").toLowerCase();
  return ABBREVIATIONS.has(word) || /^[a-z]$/.test(word);
}

/**
 * Incremental splitter. push() returns the sentences that are now certain to be complete.
 * A terminator at the very end of the buffer is held back until more text or flush().
 */
export class SentenceSplitter {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    for (;;) {
      const cut = this.findBoundary();
      if (cut < 0) break;
      const piece = cleanSpoken(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut).replace(/^\s+/, "");
      if (piece) out.push(piece);
    }
    return out;
  }

  flush(): string[] {
    const piece = cleanSpoken(this.buf);
    this.buf = "";
    return piece ? [piece] : [];
  }

  /** Index just after the end of the first complete sentence, or -1. */
  private findBoundary(): number {
    const b = this.buf;
    const nl = b.indexOf("\n");
    for (let i = 0; i < b.length; i++) {
      if (nl >= 0 && i === nl) return nl;
      const ch = b[i];
      if (ch !== "." && ch !== "!" && ch !== "?") continue;
      let j = i + 1;
      while (j < b.length && /[.!?]/.test(b[j] ?? "")) j++;
      while (j < b.length && /["')\]”’]/.test(b[j] ?? "")) j++;
      if (j >= b.length) return -1; // cannot tell yet
      if (!/\s/.test(b[j] ?? "")) {
        i = j - 1;
        continue;
      }
      if (ch === "." && j === i + 1 && endsWithAbbreviation(b.slice(0, j))) {
        i = j - 1;
        continue;
      }
      return j;
    }
    return nl >= 0 ? nl : -1;
  }
}

export function splitSentences(text: string): string[] {
  const s = new SentenceSplitter();
  return [...s.push(text), ...s.flush()];
}
