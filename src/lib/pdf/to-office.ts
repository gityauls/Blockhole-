import {
  type PageContent,
  cellValue,
  groupLines,
  groupParagraphs,
  splitColumns,
  tableRows,
  textBoxes,
} from "./layout";
import { type Sheet, buildXlsx } from "./xlsx";

// Named, not embedded: Office shows it from the reader's own fonts.
const DOCUMENT_FONT = "Malgun Gothic";
const POINTS_PER_INCH = 72;
const DOCX_IMAGE_WIDTH = 600;
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export async function toDocx(pages: PageContent[]): Promise<Blob> {
  const { Document, ImageRun, Packer, Paragraph, TextRun } = await import("docx");
  const children = [];

  for (const [index, page] of pages.entries()) {
    const breakBefore = index > 0;
    const paragraphs = splitColumns(page.runs, page.width).flatMap((column) =>
      groupParagraphs(groupLines(column)),
    );

    if (paragraphs.length === 0 && page.image) {
      const height = Math.round((DOCX_IMAGE_WIDTH * page.height) / page.width);
      children.push(
        new Paragraph({
          pageBreakBefore: breakBefore,
          children: [
            new ImageRun({
              type: "jpg",
              data: page.image,
              transformation: { width: DOCX_IMAGE_WIDTH, height },
            }),
          ],
        }),
      );
      continue;
    }

    paragraphs.forEach((paragraph, position) => {
      children.push(
        new Paragraph({
          pageBreakBefore: breakBefore && position === 0,
          spacing: { after: 120 },
          children: [
            new TextRun({
              text: paragraph.text,
              bold: paragraph.bold,
              size: Math.round(paragraph.size * 2),
              font: DOCUMENT_FONT,
            }),
          ],
        }),
      );
    });
  }

  const document = new Document({ sections: [{ children }] });
  return new Blob([await Packer.toBlob(document)], { type: MIME.docx });
}

export async function toXlsx(pages: PageContent[]): Promise<Blob> {
  const sheets: Sheet[] = [];

  for (const [index, page] of pages.entries()) {
    const rows = splitColumns(page.runs, page.width).flatMap((column) =>
      tableRows(groupLines(column)),
    );
    if (rows.length === 0) continue;
    sheets.push({
      name: `${index + 1}쪽`,
      rows: rows.map((row) => row.map((cell) => (cell ? cellValue(cell) : null))),
    });
  }

  if (sheets.length === 0) {
    throw new Error("표로 옮길 글자가 없습니다. 스캔한 PDF일 수 있습니다.");
  }
  return new Blob([new Uint8Array(buildXlsx(sheets))], { type: MIME.xlsx });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function toPptx(pages: PageContent[]): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const deck = new PptxGenJS();
  const slideWidth = pages[0].width / POINTS_PER_INCH;
  const slideHeight = pages[0].height / POINTS_PER_INCH;
  deck.defineLayout({ name: "PDF", width: slideWidth, height: slideHeight });
  deck.layout = "PDF";

  for (const page of pages) {
    const slide = deck.addSlide();
    // Pages of another size are fitted to the first page's slide.
    const scale = Math.min(slideWidth / page.width, slideHeight / page.height);

    // Not slide.background: pptxgenjs saves that as .png even for JPEG data.
    if (page.image) {
      slide.addImage({
        data: `image/jpeg;base64,${toBase64(page.image)}`,
        x: 0,
        y: 0,
        w: page.width * scale,
        h: page.height * scale,
      });
    }

    textBoxes(page.runs).forEach((line, index) => {
      slide.addText(line.text, {
        x: line.x * scale,
        y: (line.y - line.size) * scale,
        w: (line.width + line.size) * scale,
        h: line.size * 1.3 * scale,
        fontSize: line.size * scale * POINTS_PER_INCH,
        fontFace: DOCUMENT_FONT,
        bold: line.bold,
        color: page.colors[index] ?? "000000",
        margin: 0,
        valign: "top",
        wrap: false,
      });
    });
  }

  const data = (await deck.write({ outputType: "arraybuffer" })) as ArrayBuffer;
  return new Blob([data], { type: MIME.pptx });
}
