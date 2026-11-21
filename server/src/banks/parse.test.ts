import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseBank } from "./parse.ts";

const sample = readFileSync(new URL("../../../banks/sample-bank.md", import.meta.url), "utf8");

describe("question bank parser", () => {
  it("test_parses_sample_bank", () => {
    const bank = parseBank(sample, { id: "sample-bank", sourcePath: "banks/sample-bank.md" });
    expect(bank.id).toBe("sample-bank");
    expect(bank.title).toBe("Sample bank: product designer, generic role");
    expect(bank.questions).toHaveLength(12);
    const q1 = bank.questions[0]!;
    expect(q1.id).toBe("sample-bank-q1");
    expect(q1.text).toBe("Walk me through a project you are proud of.");
    expect(q1.referenceAnswer).toMatch(/^"I led the redesign/);
    expect(q1.followUpHints).toEqual(["What would you change if you did it again?"]);
    expect(q1.doNotSay).toEqual(["Do not claim the whole team result as mine alone."]);
    expect(q1.tags).toEqual(["Craft"]);
    expect(bank.questions[11]!.tags).toEqual(["Motivation"]);
    expect(new Set(bank.questions.map((q) => q.id)).size).toBe(12);
  });

  it("test_missing_answer_flag", () => {
    const bank = parseBank(sample, { id: "sample-bank", sourcePath: "x" });
    const missing = bank.questions.filter((q) => !q.hasReferenceAnswer);
    expect(missing.map((q) => q.id)).toEqual(["sample-bank-q8"]);
    expect(missing[0]!.referenceAnswer).toBeUndefined();
    expect(bank.questions[0]!.hasReferenceAnswer).toBe(true);
  });

  it("test_strips_include_directives", () => {
    const md = [
      '### 1. "Tell me about **design systems** {{include shared.md 2 /4}} please. ⭐"',
      "",
      "{{include shared.md 2 /4}}",
      "",
      "**Say:** Use the system first. {{include other.md}}",
      "",
      "Second paragraph of the answer.",
      "",
      "**Rests on:** something else",
      "",
      '**Follow-up, "Example?":** Name one.',
      "",
      "**Guard:** Do not boast.",
      "",
      "---",
    ].join("\n");
    const bank = parseBank(md, { id: "t", sourcePath: "t.md" });
    const q = bank.questions[0]!;
    expect(q.text).toBe("Tell me about design systems please.");
    expect(q.referenceAnswer).toBe("Use the system first.\n\nSecond paragraph of the answer.");
    expect(q.referenceAnswer).not.toContain("{{");
    expect(q.followUpHints).toEqual(['"Example?": Name one.']);
    expect(q.doNotSay).toEqual(["Do not boast."]);
    expect(q.tags).toEqual([]);
  });
});

describe("banks route", () => {
  it("test_banks_route_hides_answers", async () => {
    const { createApp } = await import("../index.ts");
    const res = await createApp({ QUESTION_BANK_DIR: fileURLToPath(new URL("../../../banks", import.meta.url)) }).request("/api/banks");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ banks: [{ id: "sample-bank", title: "Sample bank: product designer, generic role", questionCount: 12 }] });
    expect(text).not.toContain("referenceAnswer");
    expect(text).not.toContain("redesign of a booking");
  });
});
