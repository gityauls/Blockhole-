import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractPages, imagesToPdf, mergePdfs, splitPdf } from "./edit";

// 1x1 PNG
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

async function makePdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 100]);
  return doc.save();
}

async function widthsOf(bytes: Uint8Array): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => page.getWidth());
}

describe("mergePdfs", () => {
  it("joins files in the given order", async () => {
    const merged = await mergePdfs([
      { name: "a.pdf", bytes: await makePdf([100, 200]) },
      { name: "b.pdf", bytes: await makePdf([300]) },
    ]);
    expect(await widthsOf(merged)).toEqual([100, 200, 300]);
  });

  it("names the file that could not be read", async () => {
    await expect(
      mergePdfs([
        { name: "good.pdf", bytes: await makePdf([100]) },
        { name: "bad.pdf", bytes: new TextEncoder().encode("not a pdf") },
      ]),
    ).rejects.toThrow("bad.pdf");
  });
});

describe("splitPdf", () => {
  it("makes one file per page", async () => {
    const parts = await splitPdf(await makePdf([100, 200, 300]));
    expect(parts).toHaveLength(3);
    expect(await widthsOf(parts[2])).toEqual([300]);
  });
});

describe("extractPages", () => {
  it("keeps only the chosen pages in the chosen order", async () => {
    const out = await extractPages(await makePdf([100, 200, 300]), "3, 1");
    expect(await widthsOf(out)).toEqual([300, 100]);
  });
});

describe("imagesToPdf", () => {
  it("adds one page per image at the image size", async () => {
    const out = await imagesToPdf([
      { type: "png", bytes: PNG },
      { type: "png", bytes: PNG },
    ]);
    expect(await widthsOf(out)).toEqual([1, 1]);
  });
});
