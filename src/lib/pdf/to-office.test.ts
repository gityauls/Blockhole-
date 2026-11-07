import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { PageContent } from "./layout";
import { toDocx, toPptx, toXlsx } from "./to-office";

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
