import { describe, expect, it } from "vitest";
import { pageRangeLabel, parsePageRanges } from "./ranges";

describe("parsePageRanges", () => {
  it("returns zero-based page indexes", () => {
    expect(parsePageRanges("1-3, 5", 10)).toEqual([0, 1, 2, 4]);
  });

  it("drops repeats and keeps the typed order", () => {
    expect(parsePageRanges("5, 1-2, 2", 10)).toEqual([4, 0, 1]);
  });

  it("tolerates extra spaces", () => {
    expect(parsePageRanges("  2 - 3 ,4 ", 5)).toEqual([1, 2, 3]);
  });

  it("explains pages beyond the document", () => {
    expect(() => parsePageRanges("1-11", 10)).toThrow("1부터 10까지");
    expect(() => parsePageRanges("0", 10)).toThrow("1부터 10까지");
  });

  it("explains text that is not a range", () => {
    expect(() => parsePageRanges("abc", 10)).toThrow("abc");
    expect(() => parsePageRanges("1,,2", 10)).toThrow();
  });

  it("rejects a reversed range", () => {
    expect(() => parsePageRanges("5-3", 10)).toThrow("5-3");
  });
});

describe("pageRangeLabel", () => {
  it("keeps a range as typed", () => {
    expect(pageRangeLabel("3-7")).toBe("3-7");
  });
  it("removes spaces", () => {
    expect(pageRangeLabel(" 2 - 3 ")).toBe("2-3");
  });
  it("joins separate ranges with underscores", () => {
    expect(pageRangeLabel("1-3, 5")).toBe("1-3_5");
  });
});
