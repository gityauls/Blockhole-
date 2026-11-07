import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { type PageContent, type TextRun, textBoxes } from "./layout";

type PdfJs = typeof import("pdfjs-dist");
type OpenPdf = { pdfjs: PdfJs; doc: PDFDocumentProxy; close: () => Promise<void> };
export type PageUse = "docx" | "xlsx" | "pptx";

const RENDER_SCALE = 2;
const JPG_QUALITY = 0.92;

async function openPdf(bytes: Uint8Array): Promise<OpenPdf> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  try {
    // pdf.js takes ownership of the buffer, so give it a copy.
    const task = pdfjs.getDocument({ data: bytes.slice(), fontExtraProperties: true });
    return { pdfjs, doc: await task.promise, close: () => task.destroy() };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("암호가 걸린 PDF입니다. 암호를 푼 뒤 다시 넣어 주세요.");
    }
    throw new Error("PDF를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하세요.");
  }
}

async function renderPage(page: PDFPageProxy, hideText: boolean): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  if (hideText) {
    // pdf.js reuses this same context, so glyphs are skipped and everything else is drawn.
    const context = canvas.getContext("2d");
    if (context) {
      context.fillText = () => {};
      context.strokeText = () => {};
    }
  }
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

async function canvasJpg(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPG_QUALITY),
  );
  if (!blob) throw new Error("페이지가 너무 커서 이미지로 저장할 수 없습니다.");
  return blob;
}

const jpgBytes = async (canvas: HTMLCanvasElement) =>
  new Uint8Array(await (await canvasJpg(canvas)).arrayBuffer());

function isBoldFont(page: PDFPageProxy, id: string): boolean {
  try {
    if (!page.commonObjs.has(id)) return false;
    const font = page.commonObjs.get(id) as { name?: string; bold?: boolean; black?: boolean };
    // Embedded Korean fonts often show their weight only in the name.
    return Boolean(font.bold || font.black) || /bold|black|heavy/i.test(font.name ?? "");
  } catch {
    return false;
  }
}

async function readRuns(pdfjs: PdfJs, page: PDFPageProxy): Promise<TextRun[]> {
  const viewport = page.getViewport({ scale: 1 });
  // Font details such as bold are only available after the page has been parsed.
  await page.getOperatorList();
  const { items } = await page.getTextContent();

  const runs: TextRun[] = [];
  for (const item of items) {
    if (!("str" in item)) continue;
    const [, , c, d, x, y] = pdfjs.Util.transform(viewport.transform, item.transform);
    runs.push({
      text: item.str,
      x,
      y,
      width: item.width,
      size: Math.hypot(c, d),
      bold: isBoldFont(page, item.fontName),
    });
  }
  return runs;
}

/** Finds each line's color by comparing the page drawn with and without its text. */
function lineColors(full: HTMLCanvasElement, clean: HTMLCanvasElement, runs: TextRun[]): string[] {
  const { width, height } = full;
  const fullData = full.getContext("2d")?.getImageData(0, 0, width, height).data;
  const cleanData = clean.getContext("2d")?.getImageData(0, 0, width, height).data;
  if (!fullData || !cleanData) return [];

  return textBoxes(runs).map((line) => {
    const left = Math.max(0, Math.floor(line.x * RENDER_SCALE));
    const right = Math.min(width, Math.ceil((line.x + line.width) * RENDER_SCALE));
    const top = Math.max(0, Math.floor((line.y - line.size) * RENDER_SCALE));
    const bottom = Math.min(height, Math.ceil(line.y * RENDER_SCALE));

    let strongest = 0;
    let color = "000000";
    for (let y = top; y < bottom; y++) {
      for (let x = left; x < right; x++) {
        const at = (y * width + x) * 4;
        const difference =
          Math.abs(fullData[at] - cleanData[at]) +
          Math.abs(fullData[at + 1] - cleanData[at + 1]) +
          Math.abs(fullData[at + 2] - cleanData[at + 2]);
        if (difference > strongest) {
          strongest = difference;
          color = [fullData[at], fullData[at + 1], fullData[at + 2]]
            .map((channel) => channel.toString(16).padStart(2, "0"))
            .join("");
        }
      }
    }
    return color;
  });
}

/** Reads what each Office format needs from every page. */
export async function readPages(
  bytes: Uint8Array,
  use: PageUse,
  onPage?: (page: number, total: number) => void,
): Promise<PageContent[]> {
  const { pdfjs, doc, close } = await openPdf(bytes);
  const pages: PageContent[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      onPage?.(number, doc.numPages);
      const page = await doc.getPage(number);
      const { width, height } = page.getViewport({ scale: 1 });
      const runs = await readRuns(pdfjs, page);
      const hasText = runs.some((run) => run.text.trim());
      const content: PageContent = { width, height, runs, colors: [] };

      if (use === "pptx") {
        const clean = await renderPage(page, hasText);
        content.image = await jpgBytes(clean);
        if (hasText) content.colors = lineColors(await renderPage(page, false), clean, runs);
      } else if (use === "docx" && !hasText) {
        content.image = await jpgBytes(await renderPage(page, false));
      }

      pages.push(content);
      page.cleanup();
    }
  } finally {
    await close();
  }
  return pages;
}

export async function pdfToJpgs(
  bytes: Uint8Array,
  onPage?: (page: number, total: number) => void,
): Promise<Blob[]> {
  const { doc, close } = await openPdf(bytes);
  const images: Blob[] = [];
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      onPage?.(number, doc.numPages);
      const page = await doc.getPage(number);
      images.push(await canvasJpg(await renderPage(page, false)));
      page.cleanup();
    }
  } finally {
    await close();
  }
  return images;
}

export async function pdfToText(bytes: Uint8Array): Promise<string> {
  const { doc, close } = await openPdf(bytes);
  try {
    const pages: string[] = [];
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const { items } = await page.getTextContent();
      let text = "";
      for (const item of items) {
        if (!("str" in item)) continue;
        text += item.str + (item.hasEOL ? "\n" : "");
      }
      pages.push(text.trim());
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    await close();
  }
}
