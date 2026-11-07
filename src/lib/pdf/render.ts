import type { PDFDocumentProxy } from "pdfjs-dist";

type OpenPdf = { doc: PDFDocumentProxy; close: () => Promise<void> };

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
    const task = pdfjs.getDocument({ data: bytes.slice() });
    return { doc: await task.promise, close: () => task.destroy() };
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("암호가 걸린 PDF입니다. 암호를 푼 뒤 다시 넣어 주세요.");
    }
    throw new Error("PDF를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하세요.");
  }
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
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvas, viewport }).promise;
      page.cleanup();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", JPG_QUALITY),
      );
      if (!blob) throw new Error("페이지가 너무 커서 이미지로 저장할 수 없습니다.");
      images.push(blob);
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
