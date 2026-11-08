import { describe, expect, it } from "vitest";
import type { PageContent, TextRun } from "./layout";
import { isTwoUp, unimpose } from "./imposition";
import { takePageNumbers } from "./page-numbers";

const run = (text: string, x: number, y: number, size = 7.78): TextRun => ({
  text,
  x,
  y,
  width: text.length * size,
  size,
  bold: false,
});

// An A4 landscape sheet holding two A4 portrait pages at 1/√2, numbered at their feet.
function sheet(left: number): PageContent {
  // Body lines fill each page's 340pt text column.
  const lines = (x: number) => Array.from({ length: 12 }, (_, i) => ({ ...run(`본문 줄 ${i}`, x, 60 + i * 13), width: 340 }));
  return {
    width: 841.89,
    height: 595.28,
    runs: [...lines(40), ...lines(461), run(`- ${left} -`, 190, 560), run(`- ${left + 1} -`, 611, 560)],
    colors: [],
  };
}

describe("unimpose", () => {
  it("cuts a two-up sheet into its two pages and enlarges them back to A4", () => {
    const pages = unimpose([sheet(134)]);
    expect(pages).toHaveLength(2);
    expect(pages[0].width).toBeCloseTo(595.28, 0);
    expect(pages[0].height).toBeCloseTo(841.89, 0);
    expect(pages[0].runs[0].size).toBeCloseTo(11, 1);
    // The right page's text now starts near its own left edge.
    expect(pages[1].runs[0].x).toBeCloseTo((461 - 420.945) * Math.SQRT2, 1);
  });

  it("cuts a tall sheet holding two landscape pages into top and bottom", () => {
    const tall: PageContent = {
      width: 595.28,
      height: 841.89,
      runs: [run("위쪽 쪽의 글", 40, 100), run("위쪽 둘째 줄", 40, 113), run("아래쪽 쪽의 글", 40, 520), run("아래쪽 둘째", 40, 533)],
      colors: [],
    };
    const pages = unimpose([tall]);
    expect(pages.map((p) => Math.round(p.width))).toEqual([842, 842]);
    expect(pages[1].runs[0].text).toBe("아래쪽 쪽의 글");
  });

  it("leaves an ordinary portrait document alone", () => {
    const page: PageContent = { width: 595.28, height: 841.89, runs: [run("한 쪽 전체에 걸친 글", 60, 100)], colors: [] };
    expect(isTwoUp([page])).toBe(false);
    expect(unimpose([page])).toEqual([page]);
  });
});

describe("takePageNumbers", () => {
  it("moves counting page numbers out of the body into a footer description", () => {
    const { pages, numbers } = takePageNumbers(unimpose([sheet(134), sheet(136)]));
    expect(numbers).toMatchObject({ start: 134, prefix: "- ", suffix: " -", align: "center" });
    expect(pages.flatMap((p) => p.runs).some((r) => /- \d+ -/.test(r.text))).toBe(false);
  });

  it("keeps numbers that do not count pages, such as figures in a table's last row", () => {
    const page = (n: string): PageContent => ({ width: 595, height: 842, runs: [run("본문", 60, 100), run(n, 290, 800)], colors: [] });
    expect(takePageNumbers([page("7"), page("7"), page("7")]).numbers).toBeNull();
  });
});
