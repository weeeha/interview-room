import { describe, expect, it } from "vitest";
import { cleanSpoken, SentenceSplitter, splitSentences } from "./sentences.ts";

describe("sentence splitter", () => {
  it("test_splits_basic_sentences", () => {
    expect(splitSentences("You said you cut costs. How? Tell me more! Okay.")).toEqual([
      "You said you cut costs.",
      "How?",
      "Tell me more!",
      "Okay.",
    ]);
  });

  it("test_does_not_split_abbreviations_or_decimals", () => {
    expect(splitSentences("Dr. Lee ran it, e.g. in 3.5 weeks. Then what happened?")).toEqual([
      "Dr. Lee ran it, e.g. in 3.5 weeks.",
      "Then what happened?",
    ]);
  });

  it("test_streaming_chunks_wait_for_boundary", () => {
    const s = new SentenceSplitter();
    expect(s.push("You said you ")).toEqual([]);
    expect(s.push("moved the date")).toEqual([]);
    expect(s.push(".")).toEqual([]); // a final period is held back until more text arrives
    expect(s.push(" What made that call?")).toEqual(["You said you moved the date."]);
    expect(s.flush()).toEqual(["What made that call?"]);
  });

  it("test_newline_is_a_boundary_and_quotes_stay_attached", () => {
    expect(splitSentences('He said "stop." Then left\nNext line')).toEqual(['He said "stop."', "Then left", "Next line"]);
  });

  it("test_clean_spoken_strips_lists_and_markdown", () => {
    expect(cleanSpoken("- **Why** did you pick it?")).toBe("Why did you pick it?");
    expect(cleanSpoken("1. What next?")).toBe("What next?");
  });
});
