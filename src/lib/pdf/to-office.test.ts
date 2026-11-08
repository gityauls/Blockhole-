import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { PageContent } from "./layout";
import { cellPitch, pageGeometry, spacingAround, toDocx, toPptx, toXlsx, trackingOf } from "./to-office";

// 1x1 JPEG
const JPG = Uint8Array.from(
  atob(
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  ),
  (c) => c.charCodeAt(0),
);

const run = (text: string, x: number, y: number, bold = false) => ({
  text,
  x,
  y,
  width: text.length * 12,
  size: 12,
  bold,
});

const textPage: PageContent = {
  width: 720,
  height: 540,
  runs: [run("농업재해보험", 72, 72, true), run("1,200", 300, 72), run("두 번째 줄", 72, 200)],
  colors: [],
};
const scanPage: PageContent = { width: 720, height: 540, runs: [], colors: [], image: JPG };

async function unzip(blob: Blob) {
  return unzipSync(new Uint8Array(await blob.arrayBuffer()));
}

describe("toDocx", () => {
  it("writes page text and keeps bold", async () => {
    const files = await unzip(await toDocx([textPage]));
    const xml = strFromU8(files["word/document.xml"]);
    expect(xml).toContain("농업재해보험");
    expect(xml).toContain("두 번째 줄");
    expect(xml).toContain("<w:b/>");
  });

  it("starts each later page on a new page", async () => {
    const xml = strFromU8((await unzip(await toDocx([textPage, textPage])))["word/document.xml"]);
    expect(xml).toContain("pageBreakBefore");
  });

  it("embeds pages that have no text as images", async () => {
    const files = await unzip(await toDocx([scanPage]));
    expect(Object.keys(files).some((name) => name.startsWith("word/media/"))).toBe(true);
  });

  it("sets Word's Korean layout defaults, breaking Hangul anywhere only for text from Word", async () => {
    const styles = async (page: PageContent) => strFromU8((await unzip(await toDocx([page])))["word/styles.xml"]);
    const fromWord = await styles({ ...textPage, wrap: "anywhere" });
    expect(fromWord).toContain('w:eastAsia="ko-KR"');
    expect(fromWord).toContain('<w:wordWrap w:val="0"/><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>');
    expect(await styles({ ...textPage, wrap: "words" })).not.toContain("wordWrap");
  });

  it("uses the source page size and its margins", async () => {
    const xml = strFromU8((await unzip(await toDocx([textPage])))["word/document.xml"]);
    expect(xml).toContain('<w:pgSz w:w="14400" w:h="10800"');
    // Left from the text, right no wider than the left, top so the first baseline lands where it was.
    expect(xml).toMatch(/<w:pgMar w:top="1132" w:right="1440" w:bottom="1132" w:left="1440"/);
  });
});

describe("pageGeometry", () => {
  it("falls back to an A4 page when there is no text", () => {
    expect(pageGeometry([scanPage]).width).toBeCloseTo(595.3);
  });
});

describe("spacingAround", () => {
  const paragraph = { text: "제목", size: 10, bold: false, y: 60, bottom: 70, x: 72, width: 40, firstX: 72, restX: null, pitch: null, last: { text: "제목", width: 20 } };
  it("leaves the gap the page had before a table", () => {
    // Word's line ends 0.445 sizes below the baseline, at 74.45; Word draws the table's top border (78.8) one
    // border width below where the flow puts it, so 3.85pt are left between them.
    const table = { y: 78.8, table: { y: 78.8, height: 20 } } as unknown as Parameters<typeof spacingAround>[2];
    expect(spacingAround(paragraph, undefined, table)).toEqual({ before: 0, after: 77 });
  });
});

describe("toXlsx", () => {
  it("makes one sheet per page with numeric cells", async () => {
    const files = await unzip(await toXlsx([textPage, textPage]));
    expect(files["xl/worksheets/sheet2.xml"]).toBeDefined();
    const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
    expect(sheet).toContain("농업재해보험");
    expect(sheet).toContain("<v>1200</v>");
  });

  it("explains when there is nothing to put in a table", async () => {
    await expect(toXlsx([scanPage])).rejects.toThrow("스캔");
  });
});

describe("toPptx", () => {
  it("makes one slide per page with editable text over the page image", async () => {
    const page = { ...textPage, image: JPG };
    const files = await unzip(await toPptx([page, page]));
    expect(files["ppt/slides/slide2.xml"]).toBeDefined();
    const slide = strFromU8(files["ppt/slides/slide1.xml"]);
    expect(slide).toContain("농업재해보험");
    expect(Object.keys(files).some((name) => name.startsWith("ppt/media/"))).toBe(true);
  });

  it("uses the PDF page size", async () => {
    const files = await unzip(await toPptx([{ ...textPage, image: JPG }]));
    expect(strFromU8(files["ppt/presentation.xml"])).toContain('cx="9144000"');
  });
});

describe("trackingOf", () => {
  it("measures how much tighter than Malgun Gothic a Hangul line was set", () => {
    // Eleven Hangul characters at 10pt take 110pt in Malgun Gothic; set 3% tighter they take 106.7pt.
    expect(trackingOf({ text: "수확량감소환산고사결과", width: 106.7 }, 10)).toBeCloseTo(-0.03);
  });

  it("does not guess from short lines or lines with characters whose width was not measured", () => {
    expect(trackingOf({ text: "보통약관", width: 30 }, 10)).toBeNull();
    expect(trackingOf({ text: "면적 ∮ 적분 기호 표시", width: 100 }, 10)).toBeNull();
  });

  it("finds no spacing in text set in Malgun Gothic at normal spacing, symbols included", () => {
    // As Word sets it: five Hangul at 1, two spaces beside Hangul at 0.499 and one between ":" and "2" at 0.352, a
    // colon and two periods at 0.218, four digits at 0.551, the tilde at 0.7 and m at 0.879.
    const text = "지주의 규격 : 2.2~3.0m";
    const width = (5 + 2 * 0.499 + 0.352 + 3 * 0.218 + 4 * 0.551 + 0.7 + 0.879) * 10;
    expect(trackingOf({ text, width }, 10)).toBeCloseTo(0, 3);
  });
});

describe("cellPitch", () => {
  const line = (y: number) => ({ text: "보통", x: 0, y, width: 20, size: 6.6, bold: false, runs: [] });
  const item = { kind: "text" as const, y: 0, text: "보통약관", size: 6.6, bold: false, align: "center" as const, pitch: 10.5, edges: { first: line(10), last: line(20.5) } };

  it("spreads a Hangul word processor's block of lines evenly, as Word gives every line a full pitch", () => {
    // Two lines: one pitch plus one line of text.
    expect(cellPitch(item, "words")).toBeCloseTo((10.5 + 6.6) / 2);
  });

  it("keeps the pitch of text that came from Word", () => {
    expect(cellPitch(item, "anywhere")).toBe(10.5);
  });
});
