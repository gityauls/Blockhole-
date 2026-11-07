import { PDFDocument } from "pdf-lib";
import { parsePageRanges } from "./ranges";

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch (error) {
    if (error instanceof Error && /encrypted/i.test(error.message)) {
      throw new Error("암호가 걸린 PDF입니다. 암호를 푼 뒤 다시 넣어 주세요.");
    }
    throw new Error("PDF를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하세요.");
  }
}

async function copyPages(source: PDFDocument, indexes: number[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(source, indexes);
  pages.forEach((page) => out.addPage(page));
  return out.save();
}

export async function mergePdfs(files: { name: string; bytes: Uint8Array }[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const { name, bytes } of files) {
    let source: PDFDocument;
    try {
      source = await loadPdf(bytes);
    } catch (error) {
      throw new Error(`${name}: ${error instanceof Error ? error.message : "읽을 수 없습니다."}`);
    }
    const pages = await out.copyPages(source, source.getPageIndices());
    pages.forEach((page) => out.addPage(page));
  }
  return out.save();
}

export async function splitPdf(bytes: Uint8Array): Promise<Uint8Array[]> {
  const source = await loadPdf(bytes);
  const parts: Uint8Array[] = [];
  for (const index of source.getPageIndices()) {
    parts.push(await copyPages(source, [index]));
  }
  return parts;
}

export async function extractPages(bytes: Uint8Array, ranges: string): Promise<Uint8Array> {
  const source = await loadPdf(bytes);
  return copyPages(source, parsePageRanges(ranges, source.getPageCount()));
}

export async function imagesToPdf(
  images: { type: "jpg" | "png"; bytes: Uint8Array }[],
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const { type, bytes } of images) {
    const image = type === "jpg" ? await out.embedJpg(bytes) : await out.embedPng(bytes);
    const page = out.addPage([image.width, image.height]);
    page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  }
  return out.save();
}
