import {
  type PageContent,
  type Paragraph,
  cellValue,
  findGutter,
  groupLines,
  groupParagraphs,
  splitColumns,
  tableRows,
  textBoxes,
} from "./layout";
import { type Cell, type TableBlock, continueTable, findTables } from "./tables";
import { type Sheet, buildXlsx } from "./xlsx";

// Named, not embedded: Office shows it from the reader's own fonts.
const DOCUMENT_FONT = "Malgun Gothic";
const POINTS_PER_INCH = 72;
const DOCX_IMAGE_WIDTH = 600;
const TWIPS_PER_POINT = 20;
// Text width of the default A4 page with 1-inch margins, in twips.
const CONTENT_WIDTH = 9026;
// Word's default left and right cell padding together, in twips.
const CELL_MARGINS = 216;
const CENTER_TOLERANCE = 12;
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

type Docx = typeof import("docx");
type DocxChild = InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>;

function tableToDocx(d: Docx, block: TableBlock, maxWidth: number, centered: boolean): InstanceType<Docx["Table"]> {
  const scale = Math.min(1, maxWidth / (block.width * TWIPS_PER_POINT));
  const twips = (points: number) => Math.max(1, Math.round(points * TWIPS_PER_POINT * scale));
  const line = { style: d.BorderStyle.SINGLE, size: 4, color: "000000" };
  const none = { style: d.BorderStyle.NIL, size: 0, color: "auto" };

  const cellToDocx = (cell: Cell) => {
    const width = twips(block.columns.slice(cell.col, cell.col + cell.colSpan).reduce((a, b) => a + b, 0));
    const children: DocxChild[] = cell.items.map((item) =>
      item.kind === "table"
        ? tableToDocx(d, item.table, width - CELL_MARGINS, false)
        : new d.Paragraph({
            alignment: item.align,
            autoSpaceEastAsianText: false,
            spacing: { before: 0, after: 0 },
            children: [
              new d.TextRun({ text: item.text, bold: item.bold, size: Math.round(item.size * 2), font: DOCUMENT_FONT }),
            ],
          }),
    );
    // Word requires every cell to end with a paragraph.
    if (children.length === 0 || cell.items.at(-1)?.kind === "table") children.push(new d.Paragraph({}));
    return new d.TableCell({
      children,
      rowSpan: cell.rowSpan,
      columnSpan: cell.colSpan,
      width: { size: width, type: d.WidthType.DXA },
      verticalAlign: cell.vAlign,
      shading: cell.shade ? { fill: cell.shade, type: d.ShadingType.CLEAR, color: "auto" } : undefined,
      borders: {
        top: cell.borders.top ? line : none,
        bottom: cell.borders.bottom ? line : none,
        left: cell.borders.left ? line : none,
        right: cell.borders.right ? line : none,
      },
    });
  };

  const columnWidths = block.columns.map(twips);
  return new d.Table({
    layout: d.TableLayoutType.FIXED,
    width: { size: columnWidths.reduce((a, b) => a + b, 0), type: d.WidthType.DXA },
    columnWidths,
    alignment: centered ? d.AlignmentType.CENTER : d.AlignmentType.LEFT,
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: block.rows.map(
      (height, row) =>
        new d.TableRow({
          tableHeader: row < (block.headerRows ?? 0),
          height: { value: Math.round(height * TWIPS_PER_POINT), rule: d.HeightRule.ATLEAST },
          children: block.cells.filter((cell) => cell.row === row).map(cellToDocx),
        }),
    ),
  });
}

type FlowItem = { y: number } & ({ paragraph: Paragraph; centered: boolean } | { table: TableBlock; centered: boolean });

/** Orders a page's paragraphs and tables for reading: column by column, top to bottom. */
function pageFlow(page: PageContent): FlowItem[] {
  const { tables, rest } = page.shapes
    ? findTables(page.runs, page.shapes.lines, page.shapes.fills, page.wrap)
    : { tables: [], rest: page.runs };
  const gutter = findGutter(rest, page.width, tables);
  const regions = gutter === null ? [[0, page.width]] : [[0, gutter], [gutter, page.width]];
  const middle = (box: { x: number; width: number }) => box.x + box.width / 2;
  const within = ([left, right]: number[]) => (box: { x: number; width: number }) =>
    middle(box) >= left && middle(box) < right;

  return regions.flatMap((region) => {
    const regionRuns = rest.filter(within(region));
    const paragraphs = groupParagraphs(groupLines(regionRuns), page.wrap);
    const regionCenter = (region[0] + region[1]) / 2;
    const textLeft = Math.min(...regionRuns.map((run) => run.x));
    // Centered: its middle sits on the column's middle and it starts well inside the text margin.
    const centered = (p: Paragraph) =>
      Math.abs(middle(p) - regionCenter) < CENTER_TOLERANCE &&
      p.width < (region[1] - region[0]) * 0.7 &&
      p.x - textLeft > p.size * 2;
    const items: FlowItem[] = [
      ...paragraphs.map((paragraph) => ({ y: paragraph.y, paragraph, centered: centered(paragraph) })),
      ...tables.filter(within(region)).map((table) => ({
        y: table.y,
        table,
        centered: Math.abs(middle(table) - (region[0] + region[1]) / 2) < CENTER_TOLERANCE,
      })),
    ];
    return items.sort((a, b) => a.y - b.y);
  });
}

export async function toDocx(pages: PageContent[]): Promise<Blob> {
  const d = await import("docx");
  const children: DocxChild[] = [];
  const flows = pages.map(pageFlow);

  // A table that runs onto the next page is one table in Word, which breaks it across pages itself.
  const continues = flows.map(() => false);
  for (let index = 1; index < flows.length; index++) {
    const before = flows[index - 1].at(-1);
    const first = flows[index][0];
    if (!before || !first || !("table" in before) || !("table" in first)) continue;
    const joined = continueTable(before.table, first.table);
    if (!joined) continue;
    before.table = joined;
    flows[index].shift();
    continues[index] = true;
  }

  for (const [index, page] of pages.entries()) {
    const breakBefore = index > 0 && !continues[index];
    const flow = flows[index];

    if (flow.length === 0 && page.image && !continues[index]) {
      const height = Math.round((DOCX_IMAGE_WIDTH * page.height) / page.width);
      children.push(
        new d.Paragraph({
          pageBreakBefore: breakBefore,
          children: [
            new d.ImageRun({
              type: "jpg",
              data: page.image,
              transformation: { width: DOCX_IMAGE_WIDTH, height },
            }),
          ],
        }),
      );
      continue;
    }

    let previousWasTable = false;
    flow.forEach((item, position) => {
      const pageBreak = breakBefore && position === 0;
      if ("table" in item) {
        // A table cannot start a page itself, and two tables in a row would merge into one.
        if (pageBreak || previousWasTable) {
          children.push(new d.Paragraph({ pageBreakBefore: pageBreak, spacing: { before: 0, after: 0 } }));
        }
        children.push(tableToDocx(d, item.table, CONTENT_WIDTH, item.centered));
        previousWasTable = true;
        return;
      }
      const { paragraph } = item;
      children.push(
        new d.Paragraph({
          pageBreakBefore: pageBreak,
          alignment: item.centered ? d.AlignmentType.CENTER : undefined,
          // Positions in the PDF already include any spacing, so Word must not add more.
          autoSpaceEastAsianText: false,
          spacing: { after: 120 },
          children: [
            new d.TextRun({
              text: paragraph.text,
              bold: paragraph.bold,
              size: Math.round(paragraph.size * 2),
              font: DOCUMENT_FONT,
            }),
          ],
        }),
      );
      previousWasTable = false;
    });
  }
  // A document cannot end with a table.
  if (children.at(-1) instanceof d.Table) children.push(new d.Paragraph({}));

  const document = new d.Document({ sections: [{ children }] });
  return new Blob([await d.Packer.toBlob(document)], { type: MIME.docx });
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
