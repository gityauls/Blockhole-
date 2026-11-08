import {
  type PageContent,
  type Wrap,
  type Paragraph,
  cellValue,
  findGutter,
  groupLines,
  groupParagraphs,
  splitColumns,
  tableRows,
  textBoxes,
} from "./layout";
import { type Cell, type CellParagraph, type TableBlock, continueTable, findTables } from "./tables";
import { type Sheet, buildXlsx } from "./xlsx";

// Named, not embedded: Office shows it from the reader's own fonts.
const DOCUMENT_FONT = "Malgun Gothic";
const POINTS_PER_INCH = 72;
const TWIPS_PER_POINT = 20;
const PIXELS_PER_POINT = 96 / 72;
// Word's default page, A4 with 1-inch margins, for documents with no text to measure.
const DEFAULT_PAGE = { width: 595.3, height: 841.9, top: 72, right: 72, bottom: 72, left: 72 };
const MIN_MARGIN = 18;
const CENTER_TOLERANCE = 12;
// Where Word sets the baseline in a single-spaced line of the document font, in font sizes, measured from Word's own
// PDFs: the line box of Malgun Gothic is about 1.73 sizes tall, 1.25 above the baseline and 0.48 below it.
const LINE_ASCENT = 1.25;
const LINE_DESCENT = 0.48;
const NATURAL_LINE = LINE_ASCENT + LINE_DESCENT;
// Baselines closer than this share to the natural line keep Word's own line spacing.
const LEADING_TOLERANCE = 0.05;
// Word draws a cell border on top of the row height it is given; ours are 0.5pt (size 4).
const BORDER_WIDTH = 0.5;

/** Line spacing for a paragraph of the given font size and measured baseline pitch, if Word's own would differ. */
type Leading = (size: number, pitch?: number | null) => { line: number; lineRule: "exact" } | undefined;

/**
 * How far apart the source sets its baselines, in font sizes: the median over paragraphs of more than one line.
 * Single-line paragraphs, which show no pitch of their own, use it.
 */
export function lineRatio(paragraphs: { size: number; pitch?: number | null }[]): number {
  const ratios = paragraphs
    .flatMap((p) => (p.pitch ? [p.pitch / p.size] : []))
    .filter((ratio) => ratio > 0.8 && ratio < 3)
    .sort((a, b) => a - b);
  return ratios.length ? ratios[ratios.length >> 1] : NATURAL_LINE;
}

/**
 * Sets each paragraph's lines exactly as far apart as the source did. Malgun Gothic's natural line is 1.73 sizes
 * tall, while Hangul word processors often set 1.2 to 1.6, so without this dense tables grow off the page.
 */
export function leadingFor(ratio: number): Leading {
  return (size, pitch) => {
    const target = pitch ?? ratio * size;
    const natural = NATURAL_LINE * size;
    if (Math.abs(target - natural) <= natural * LEADING_TOLERANCE) return undefined;
    return { line: Math.round(target * TWIPS_PER_POINT), lineRule: "exact" };
  };
}

/** Every paragraph in a table, nested tables included. */
function cellParagraphsOf(table: TableBlock): CellParagraph[] {
  return table.cells.flatMap((cell) =>
    cell.items.flatMap((item) => (item.kind === "text" ? [item] : cellParagraphsOf(item.table))),
  );
}
const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

type Docx = typeof import("docx");
type DocxChild = InstanceType<Docx["Paragraph"]> | InstanceType<Docx["Table"]>;

/** indent is how far the table sits right of its column's edge, in points. */
function tableToDocx(
  d: Docx,
  block: TableBlock,
  maxWidth: number,
  centered: boolean,
  leading: Leading,
  indent = 0,
): InstanceType<Docx["Table"]> {
  const scale = Math.min(1, maxWidth / (block.width * TWIPS_PER_POINT));
  const twips = (points: number) => Math.max(1, Math.round(points * TWIPS_PER_POINT * scale));
  const line = { style: d.BorderStyle.SINGLE, size: 4, color: "000000" };
  const none = { style: d.BorderStyle.NIL, size: 0, color: "auto" };
  const padding = twips(block.padding);

  const cellToDocx = (cell: Cell) => {
    const width = twips(block.columns.slice(cell.col, cell.col + cell.colSpan).reduce((a, b) => a + b, 0));
    const children: DocxChild[] = cell.items.map((item) =>
      item.kind === "table"
        ? tableToDocx(d, item.table, width - padding * 2, false, leading)
        : new d.Paragraph({
            alignment: item.align,
            spacing: { before: 0, after: 0, ...leading(item.size, item.pitch) },
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
    ...(indent >= 1 ? { indent: { size: Math.round(indent * TWIPS_PER_POINT), type: d.WidthType.DXA } } : {}),
    margins: { left: padding, right: padding, top: 0, bottom: 0 },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: block.rows.map(
      (height, row) =>
        new d.TableRow({
          tableHeader: row < (block.headerRows ?? 0),
          height: block.joinedRows?.includes(row)
            ? undefined
            : { value: Math.round(Math.max(0, height - BORDER_WIDTH) * TWIPS_PER_POINT), rule: d.HeightRule.ATLEAST },
          children: block.cells.filter((cell) => cell.row === row).map(cellToDocx),
        }),
    ),
  });
}

/** left is where the item's column starts on the page, which its indentation is measured from. */
type FlowItem = { y: number; column: number; left: number; centered: boolean } & (
  | { paragraph: Paragraph }
  | { table: TableBlock }
);

/** The paragraph's indentation in twips: its later lines from the column edge, and its first line from those. */
export function indentOf(paragraph: Paragraph, left: number) {
  const twips = (points: number) => Math.round(points * TWIPS_PER_POINT);
  const rest = paragraph.restX ?? paragraph.firstX;
  const base = Math.max(0, rest - left);
  const first = paragraph.firstX - rest;
  if (base < 1 && Math.abs(first) < 1) return undefined;
  return {
    left: twips(base),
    ...(first >= 1 ? { firstLine: twips(first) } : first <= -1 ? { hanging: twips(-first) } : {}),
  };
}
/** The span a column's text and tables take up on the page. */
type Column = { left: number; right: number };
type PageFlow = { items: FlowItem[]; columns: Column[] };

/** Orders a page's paragraphs and tables for reading, column by column and top to bottom, and measures the columns. */
function pageFlow(page: PageContent): PageFlow {
  const { tables, rest } = page.shapes
    ? findTables(page.runs, page.shapes.lines, page.shapes.fills, page.wrap)
    : { tables: [], rest: page.runs };
  const gutter = findGutter(rest, page.width, tables);
  const regions = gutter === null ? [[0, page.width]] : [[0, gutter], [gutter, page.width]];
  const middle = (box: { x: number; width: number }) => box.x + box.width / 2;
  const within = ([left, right]: number[]) => (box: { x: number; width: number }) =>
    middle(box) >= left && middle(box) < right;

  const items: FlowItem[] = [];
  const columns: Column[] = [];
  regions.forEach((region, column) => {
    const regionRuns = rest.filter(within(region)).filter((run) => run.text.trim());
    const regionTables = tables.filter(within(region));
    const boxes = [...regionRuns, ...regionTables];
    const span = boxes.length
      ? { left: Math.min(...boxes.map((box) => box.x)), right: Math.max(...boxes.map((box) => box.x + box.width)) }
      : { left: region[0], right: region[1] };
    columns.push(span);
    // Word centers within the column, so compare with the middle of what the column holds.
    const center = (span.left + span.right) / 2;
    const centered = (p: Paragraph) =>
      Math.abs(middle(p) - center) < CENTER_TOLERANCE &&
      p.width < (span.right - span.left) * 0.7 &&
      p.x - span.left > p.size * 2;
    const columnItems: FlowItem[] = [
      ...groupParagraphs(groupLines(regionRuns), page.wrap).map((paragraph) => ({
        y: paragraph.y,
        column,
        left: span.left,
        paragraph,
        centered: centered(paragraph),
      })),
      ...regionTables.map((table) => ({
        y: table.y,
        column,
        left: span.left,
        table,
        centered: Math.abs(middle(table) - center) < CENTER_TOLERANCE,
      })),
    ];
    items.push(...columnItems.sort((a, b) => a.y - b.y));
  });
  return { items, columns };
}

/**
 * Space before and after a paragraph, in twips, so that Word puts the next paragraph or table where the page had
 * it. Space before is set only after a table, since the paragraph before otherwise supplies it. Items in another
 * column come out negative and get no space.
 */
export function spacingAround(paragraph: Paragraph, before?: FlowItem, after?: FlowItem): { before: number; after: number } {
  const twips = (points: number) => Math.round(Math.max(0, points) * TWIPS_PER_POINT);
  const top = paragraph.y + paragraph.size - paragraph.size * LINE_ASCENT;
  const bottom = paragraph.bottom + paragraph.size * LINE_DESCENT;
  const nextTop = !after
    ? bottom
    : "table" in after
      ? after.table.y
      : after.paragraph.y + after.paragraph.size - after.paragraph.size * LINE_ASCENT;
  return {
    before: before && "table" in before ? twips(top - (before.table.y + before.table.height)) : 0,
    after: twips(nextTop - bottom),
  };
}

type PageGeometry = typeof DEFAULT_PAGE;

/**
 * The source's page size and margins, measured from where its text and tables sit, so that Word wraps lines and
 * sizes tables as the page did. Text rarely reaches the right or bottom margin exactly, so those are never taken
 * wider than the left and top: a larger text area only spares a break, while a smaller one adds line and page breaks.
 */
export function pageGeometry(pages: PageContent[], tables: TableBlock[][] = []): PageGeometry {
  const first = pages.find((page) => page.runs.some((run) => run.text.trim()));
  if (!first) return DEFAULT_PAGE;
  const sameSize = (page: PageContent) => Math.abs(page.width - first.width) < 1 && Math.abs(page.height - first.height) < 1;
  const boxes = pages.flatMap((page, index) =>
    sameSize(page)
      ? [
          ...page.runs
            .filter((run) => run.text.trim())
            // Word's line starts this far above the baseline, so the margin puts the first baseline where it was.
            .map((run) => ({ x: run.x, y: run.y - run.size * LINE_ASCENT, right: run.x + run.width, bottom: run.y })),
          ...(tables[index] ?? []).map((table) => ({
            x: table.x,
            y: table.y,
            right: table.x + table.width,
            bottom: table.y + table.height,
          })),
        ]
      : [],
  );
  const clamp = (gap: number, side: number) => Math.min(side / 4, Math.max(MIN_MARGIN, gap));
  const left = clamp(Math.min(...boxes.map((box) => box.x)), first.width);
  const right = Math.min(left, clamp(first.width - Math.max(...boxes.map((box) => box.right)), first.width));
  const top = clamp(Math.min(...boxes.map((box) => box.y)), first.height);
  const bottom = Math.min(top, clamp(first.height - Math.max(...boxes.map((box) => box.bottom)), first.height));
  return { width: first.width, height: first.height, left, right, top, bottom };
}

/**
 * Sets the paragraph defaults Word itself uses for a Korean document, which the docx library cannot write: no extra
 * space between Hangul and Latin letters (autoSpaceDE) and, for text from Word, breaking Hangul anywhere in a word
 * (wordWrap off).
 */
async function withKoreanLayout(blob: Blob, wrap: Wrap): Promise<Blob> {
  const { strFromU8, strToU8, unzipSync, zipSync } = await import("fflate");
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const styles = strFromU8(files["word/styles.xml"]);
  // Widow control off as well: the page already decided where lines break, and Word would move single lines.
  const defaults = `<w:widowControl w:val="0"/>${wrap === "anywhere" ? '<w:wordWrap w:val="0"/>' : ""}<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/>`;
  // The library writes no paragraph defaults of its own.
  const pPrDefault = `<w:pPrDefault><w:pPr>${defaults}</w:pPr></w:pPrDefault>`;
  files["word/styles.xml"] = strToU8(styles.replace(/<w:pPrDefault\/>|<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/, pPrDefault));
  return new Blob([zipSync(files)], { type: MIME.docx });
}

/** Pages in a row that share a column layout become one Word section. */
type Section = { pages: number[]; columns: number; columnWidth: number; space: number };
const MIN_COLUMN_SPACE = 12;

/**
 * Groups pages into sections by their number of columns. Pages without text join the section before them. Two
 * columns are laid out as Word columns of equal width, separated by the narrowest gap the pages leave between them.
 */
function sectionsOf(flows: PageFlow[], contentWidth: number): Section[] {
  const sections: Section[] = [];
  flows.forEach((flow, index) => {
    const columns = flow.columns.length;
    const last = sections.at(-1);
    if (last && (last.columns === columns || flow.items.length === 0)) last.pages.push(index);
    else sections.push({ pages: [index], columns, columnWidth: contentWidth, space: 0 });
  });
  for (const section of sections) {
    if (section.columns < 2) continue;
    const double = section.pages.map((index) => flows[index].columns).filter((columns) => columns.length > 1);
    // Ragged lines end short of the column edge, so the widest reach on any page is the closest to it.
    const leftEdge = Math.max(...double.map(([left]) => left.right));
    const rightEdge = Math.min(...double.map(([, right]) => right.left));
    section.space = Math.max(MIN_COLUMN_SPACE, rightEdge - leftEdge);
    section.columnWidth = (contentWidth - section.space) / 2;
  }
  return sections;
}

export async function toDocx(pages: PageContent[]): Promise<Blob> {
  const d = await import("docx");
  const flows = pages.map(pageFlow);
  // Measured before tables are joined across pages, which changes their heights.
  const geometry = pageGeometry(
    pages,
    flows.map((flow) => flow.items.flatMap((item) => ("table" in item ? [item.table] : []))),
  );
  const contentWidth = geometry.width - geometry.left - geometry.right;
  const wrap = pages.find((page) => page.wrap)?.wrap ?? "words";
  const leading = leadingFor(
    lineRatio(
      flows.flatMap((flow) =>
        flow.items.flatMap((item): { size: number; pitch?: number | null }[] =>
          "table" in item ? cellParagraphsOf(item.table) : [item.paragraph],
        ),
      ),
    ),
  );
  const sections = sectionsOf(flows, contentWidth);
  const sectionOf = new Map(sections.flatMap((section) => section.pages.map((index) => [index, section] as const)));

  // A table that runs onto the next page is one table in Word, which breaks it across pages itself.
  const continues = flows.map(() => false);
  for (let index = 1; index < flows.length; index++) {
    if (sectionOf.get(index) !== sectionOf.get(index - 1)) continue;
    const before = flows[index - 1].items.at(-1);
    const first = flows[index].items[0];
    if (!before || !first || !("table" in before) || !("table" in first)) continue;
    const joined = continueTable(before.table, first.table);
    if (!joined) continue;
    before.table = joined;
    flows[index].items.shift();
    continues[index] = true;
  }

  const sectionChildren = sections.map((section) => {
    const children: DocxChild[] = [];
    const width = section.columnWidth * TWIPS_PER_POINT;

    section.pages.forEach((index, order) => {
      const page = pages[index];
      const { items } = flows[index];
      // A new section starts a new page by itself.
      const breakBefore = order > 0 && !continues[index];

      if (items.length === 0 && page.image && !continues[index]) {
        const pixels = Math.round(section.columnWidth * PIXELS_PER_POINT);
        children.push(
          new d.Paragraph({
            pageBreakBefore: breakBefore,
            children: [
              new d.ImageRun({
                type: "jpg",
                data: page.image,
                transformation: { width: pixels, height: Math.round((pixels * page.height) / page.width) },
              }),
            ],
          }),
        );
        return;
      }

      let previousWasTable = false;
      let column = 0;
      items.forEach((item, position) => {
        const pageBreak = breakBefore && position === 0;
        // The right column starts with a column break; within the page the left column fills first.
        const columnBreak = item.column !== column;
        column = item.column;
        const neighbor = (other?: FlowItem) => (other?.column === item.column ? other : undefined);
        if ("table" in item) {
          // A table cannot start a page or column itself, and two tables in a row would merge into one.
          if (pageBreak || columnBreak || previousWasTable) {
            children.push(
              new d.Paragraph({
                pageBreakBefore: pageBreak,
                spacing: { before: 0, after: 0 },
                children: columnBreak ? [new d.ColumnBreak()] : [],
              }),
            );
          }
          const indent = item.centered ? 0 : item.table.x - item.left;
          children.push(
            tableToDocx(d, item.table, width - Math.max(0, indent) * TWIPS_PER_POINT, item.centered, leading, indent),
          );
          previousWasTable = true;
          return;
        }
        const { paragraph } = item;
        children.push(
          new d.Paragraph({
            pageBreakBefore: pageBreak,
            alignment: item.centered ? d.AlignmentType.CENTER : undefined,
            indent: item.centered ? undefined : indentOf(paragraph, item.left),
            spacing: {
              ...spacingAround(paragraph, neighbor(items[position - 1]), neighbor(items[position + 1])),
              ...leading(paragraph.size, paragraph.pitch),
            },
            children: [
              ...(columnBreak ? [new d.ColumnBreak()] : []),
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
    });
    // A section cannot end with a table.
    if (children.length === 0 || children.at(-1) instanceof d.Table) children.push(new d.Paragraph({}));
    return children;
  });

  const twips = (points: number) => Math.round(points * TWIPS_PER_POINT);
  const document = new d.Document({
    // Word's own defaults for a Korean document. Without the Korean East Asian language and East Asian layout,
    // Word lays Hangul out by Latin rules: it breaks lines only between words and widens gaps around digits.
    styles: {
      default: {
        document: {
          run: { language: { value: "en-US", eastAsia: "ko-KR" } },
        },
      },
    },
    compatibility: { useFELayout: true, balanceSingleByteDoubleByteWidth: true, adjustLineHeightInTable: true },
    sections: sections.map((section, index) => ({
      properties: {
        page: {
          size: { width: twips(geometry.width), height: twips(geometry.height) },
          margin: {
            top: twips(geometry.top),
            right: twips(geometry.right),
            bottom: twips(geometry.bottom),
            left: twips(geometry.left),
          },
        },
        ...(section.columns > 1 ? { column: { count: 2, space: twips(section.space), equalWidth: true } } : {}),
      },
      children: sectionChildren[index],
    })),
  });
  return withKoreanLayout(await d.Packer.toBlob(document), wrap);
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
