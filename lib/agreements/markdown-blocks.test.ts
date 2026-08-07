import { describe, expect, it } from "vitest";
import { blockText, markdownToBlocks } from "./markdown-blocks";

describe("markdownToBlocks", () => {
  it("parses the three heading levels", () => {
    const b = markdownToBlocks("# One\n\n## Two\n\n### Three");
    expect(b.map((x) => x.kind)).toEqual(["h1", "h2", "h3"]);
    expect(blockText(b[0])).toBe("One");
    expect(blockText(b[2])).toBe("Three");
  });

  it("treats blank-line separated text as separate paragraphs", () => {
    const b = markdownToBlocks("First para.\n\nSecond para.");
    expect(b.map((x) => x.kind)).toEqual(["p", "p"]);
    expect(blockText(b[1])).toBe("Second para.");
  });

  it("joins wrapped lines within one paragraph", () => {
    const b = markdownToBlocks("one line\ncontinues here");
    expect(b).toHaveLength(1);
    expect(blockText(b[0])).toBe("one line continues here");
  });

  it("parses both bullet markers and numbered items", () => {
    const b = markdownToBlocks("- alpha\n* beta\n\n1. first\n2. second");
    expect(b.map((x) => x.kind)).toEqual(["bullet", "bullet", "number", "number"]);
    expect(blockText(b[0])).toBe("alpha");
    expect(blockText(b[3])).toBe("second");
  });

  it("keeps the author's own numbering — clause numbers are referenced in agreements", () => {
    const b = markdownToBlocks("1. first\n2. second\n\n7. jumps to seven");
    expect(b.map((x) => x.marker)).toEqual(["1.", "2.", "7."]);
    // The number is NOT part of the text — renderers place it themselves.
    expect(blockText(b[0])).toBe("first");
  });

  it("preserves a closing-paren marker style", () => {
    expect(markdownToBlocks("3) third")[0].marker).toBe("3)");
  });

  it("gives non-numbered blocks no marker", () => {
    const b = markdownToBlocks("- alpha\n\nplain para");
    expect(b[0].marker).toBeUndefined();
    expect(b[1].marker).toBeUndefined();
  });

  it("splits bold runs inside a paragraph", () => {
    const b = markdownToBlocks("plain **bold** tail");
    expect(b[0].runs).toEqual([
      { text: "plain ", bold: false },
      { text: "bold", bold: true },
      { text: " tail", bold: false },
    ]);
  });

  it("handles bold inside a list item", () => {
    const b = markdownToBlocks("- pay **30 days** net");
    expect(b[0].kind).toBe("bullet");
    expect(b[0].runs.some((r) => r.bold && r.text === "30 days")).toBe(true);
  });

  it("degrades unsupported syntax to plain text rather than throwing", () => {
    const b = markdownToBlocks("> a quote\n\n| a | table |\n\n```code```");
    expect(b.every((x) => x.kind === "p")).toBe(true);
    expect(blockText(b[0])).toContain("a quote");
  });

  it("never emits raw html as markup", () => {
    const b = markdownToBlocks("<script>alert(1)</script>");
    expect(blockText(b[0])).toBe("<script>alert(1)</script>");
  });

  it("returns an empty array for empty input", () => {
    expect(markdownToBlocks("")).toEqual([]);
    expect(markdownToBlocks("   \n\n  ")).toEqual([]);
  });

  it("ignores an unmatched bold marker", () => {
    const b = markdownToBlocks("a ** dangling");
    expect(b).toHaveLength(1);
    expect(blockText(b[0])).toBe("a ** dangling");
  });
});
