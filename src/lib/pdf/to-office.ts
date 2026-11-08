import {
  type Leader,
  type Line,
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
import { type Cell, type CellItem, type CellParagraph, type TableBlock, continueTable, findTables } from "./tables";
import { unimpose } from "./imposition";
import { takePageNumbers } from "./page-numbers";
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
// PDFs: the line box of Malgun Gothic is about 1.73 sizes tall, 1.285 above the baseline and 0.445 below it. (The
// first baseline of all five samples sat 0.4pt low at 10pt with 1.25, which spacing between lines cannot show.)
const LINE_ASCENT = 1.285;
const LINE_DESCENT = 0.445;
const NATURAL_LINE = LINE_ASCENT + LINE_DESCENT;
// Baselines closer than this share to the natural line keep Word's own line spacing.
const LEADING_TOLERANCE = 0.05;
// Word draws a cell border on top of the row height it is given; ours are 0.5pt (size 4).
const BORDER_WIDTH = 0.5;
// Word draws a table's top border this far below where the text before it ends, and starts the text after it this
// far below the middle of its bottom border: one border width each, measured in Word's own PDF of our samples.
const BEFORE_TABLE = BORDER_WIDTH;
const AFTER_TABLE = BORDER_WIDTH;

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

// Advance widths of the document font, Malgun Gothic, as Word sets it with this converter's Korean defaults, in font
// sizes. Measured from Word's PDF of a document of repeated characters (scripts/fidelity/malgun-widths.mjs), not
// read from the font file. Hangul, Hanja and full-width forms are one size wide.
const MALGUN_WIDTHS: Record<string, number> = { "0": 0.551, "1": 0.551, "2": 0.551, "3": 0.551, "4": 0.551, "5": 0.551, "6": 0.551, "7": 0.551, "8": 0.551, "9": 0.551, "!": 0.289, "\"": 0.395, "#": 0.605, "$": 0.551, "%": 0.835, "&": 0.817, "'": 0.232, "(": 0.304, ")": 0.304, "*": 0.424, "+": 0.7, ",": 0.218, "-": 0.41, ".": 0.218, "/": 0.396, ":": 0.218, ";": 0.218, "<": 0.7, "=": 0.7, ">": 0.7, "?": 0.46, "@": 0.979, "A": 0.658, "B": 0.583, "C": 0.635, "D": 0.717, "E": 0.516, "F": 0.498, "G": 0.701, "H": 0.724, "I": 0.269, "J": 0.36, "K": 0.59, "L": 0.48, "M": 0.916, "N": 0.764, "O": 0.772, "P": 0.569, "Q": 0.772, "R": 0.611, "S": 0.542, "T": 0.533, "U": 0.702, "V": 0.634, "W": 0.953, "X": 0.6, "Y": 0.564, "Z": 0.581, "[": 0.304, "\\": 0.764, "]": 0.304, "^": 0.7, "_": 0.425, "`": 0.271, "a": 0.519, "b": 0.6, "c": 0.472, "d": 0.601, "e": 0.534, "f": 0.316, "g": 0.601, "h": 0.578, "i": 0.245, "j": 0.245, "k": 0.505, "l": 0.245, "m": 0.879, "n": 0.578, "o": 0.6, "p": 0.6, "q": 0.601, "r": 0.352, "s": 0.433, "t": 0.344, "u": 0.578, "v": 0.486, "w": 0.735, "x": 0.465, "y": 0.492, "z": 0.461, "{": 0.304, "|": 0.24, "}": 0.304, "~": 0.7, "·": 0.218, "•": 0.417, "※": 0.799, "→": 0.949, "←": 0.949, "↑": 0.949, "↓": 0.949, "↔": 0.95, "⇒": 0.949, "∼": 0.684, "～": 0.999, "㎜": 0.999, "㎡": 0.999, "㎝": 0.999, "㎞": 0.999, "㎏": 0.999, "ℓ": 0.331, "①": 0.999, "②": 0.999, "③": 0.999, "④": 0.999, "⑤": 0.999, "⑥": 0.999, "⑦": 0.999, "⑧": 0.999, "⑨": 0.999, "⑩": 0.999, "○": 0.999, "●": 0.999, "□": 0.999, "■": 0.999, "△": 0.999, "▲": 0.999, "▽": 0.999, "◇": 0.999, "◆": 0.999, "☞": 0.999, "✓": 0.748, "×": 0.7, "÷": 0.7, "±": 0.7, "≤": 0.7, "≥": 0.7, "≠": 0.7, "∙": 0.315, "‘": 0.23, "’": 0.23, "“": 0.378, "”": 0.378, "「": 0.569, "」": 0.569, "『": 0.516, "』": 0.516, "〈": 0.541, "〉": 0.541, "《": 0.596, "》": 0.596, "…": 0.739, "–": 0.513, "—": 1.024, "‐": 0.331, "²": 0.373, "³": 0.373, "°": 0.386, "℃": 0.949, "Ⅰ": 0.949, "Ⅱ": 0.949, "Ⅲ": 0.949, "Ⅳ": 0.949, " ": 0.499 };
const FULL_WIDTH = /[\u1100-\u11ff\u3130-\u318f\u4e00-\u9fff\uac00-\ud7af\uff01-\uff5e]/;

/** A character's advance in font sizes, or null when it was not measured. */
function malgunAdvance(char: string): number | null {
  if (FULL_WIDTH.test(char)) return 1;
  return MALGUN_WIDTHS[char] ?? null;
}

// A space next to a double-byte character (Hangul, or a symbol such as • ※ ㎜) is widened toward it
// (balanceSingleByteDoubleByteWidth); between two single-byte characters ("98 -", "² -") it keeps the font's own
// width. Measured in Word's PDFs of our samples: 0.48-0.51 against 0.34-0.36.
const NARROW_SPACE = 0.352;
const DOUBLE_BYTE = /[ᄀ-ᇿ -￿]/;

function spaceAdvance(before?: string, after?: string): number {
  const wide = [before, after].some((char) => char !== undefined && DOUBLE_BYTE.test(char));
  return wide || before === undefined || after === undefined ? MALGUN_WIDTHS[" "] : NARROW_SPACE;
}

// A line this short says too little about its spacing.
const MIN_TRACKING_SAMPLE = 8;
const TRACKING_TOLERANCE = 0.02;
const MAX_TRACKING = 0.1;
const MIN_TRACKING = -0.15;

/**
 * Letter spacing of a line, in font sizes per character: how much wider or narrower it was set than Malgun Gothic
 * at normal spacing. Hangul word processors often tighten text (the textbook's .hwp sets -1% to -8% on a third of
 * its characters), and without matching it Word fits fewer characters on a line and wraps earlier.
 */
export function trackingOf(sample: { text: string; width: number }, size: number): number | null {
  const chars = [...sample.text];
  if (chars.length < MIN_TRACKING_SAMPLE) return null;
  // Only lines made of measured characters say how they were spaced.
  const advances = chars.map((char, i) =>
    char === " " ? spaceAdvance(chars[i - 1], chars[i + 1]) : malgunAdvance(char),
  );
  if (advances.some((advance) => advance === null)) return null;
  const natural = (advances as number[]).reduce((sum, advance) => sum + advance, 0) * size;
  return (sample.width - natural) / chars.length / size;
}

/** Letter spacing in twips for a paragraph, from its own last line or else the typical spacing around it. */
type Tracking = (size: number, sample?: { text: string; width: number }) => number | undefined;

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : null;
}

export function trackingFor(samples: { size: number; last?: { text: string; width: number } }[]): Tracking {
  const typical =
    median(samples.flatMap((p) => (p.last ? [trackingOf(p.last, p.size)] : [])).filter((r): r is number => r !== null)) ?? 0;
  return (size, sample) => {
    const ratio = (sample && trackingOf(sample, size)) ?? typical;
    if (Math.abs(ratio) < TRACKING_TOLERANCE) return undefined;
    return Math.round(Math.min(MAX_TRACKING, Math.max(MIN_TRACKING, ratio)) * size * TWIPS_PER_POINT);
  };
}

/** How text is set in one context, body or table cells: line spacing and letter spacing. */
type Typesetting = { leading: Leading; tracking: Tracking; ratio: number };

function typesetting(paragraphs: { size: number; pitch?: number | null; last?: { text: string; width: number } }[]): Typesetting {
  const ratio = lineRatio(paragraphs);
  return { leading: leadingFor(ratio), tracking: trackingFor(paragraphs), ratio };
}

// A gap counts as a blank line once it is this share of a line or more.
const BLANK_LINE_SHARE = 0.65;

/**
 * The gap the writer left before `item` in a cell, beyond where Word would put it anyway: whole blank lines, and
 * the rest in points as space before the item. Word puts text right under a table, a table right under text's
 * last line, and text one pitch under the line before.
 */
export function gapBefore(
  previous: CellItem,
  item: CellItem,
  ratio: number,
  /** The line spacing Word will give `item`, when it is text: the gap is what that spacing leaves over. */
  advance?: number,
): { blanks: number; before: number } {
  const text = item.kind === "text" ? item : previous.kind === "text" ? previous : null;
  if (!text) return { blanks: 0, before: 0 };
  const pitch = (item.kind === "text" ? advance : undefined) ?? text.pitch ?? ratio * text.size;
  const bottom = previous.kind === "table" ? previous.table.y + previous.table.height + AFTER_TABLE : null;
  let extra: number;
  if (item.kind === "text" && item.edges) {
    const firstBaseline = item.edges.first.y;
    extra =
      bottom !== null
        ? firstBaseline - (bottom + LINE_ASCENT * item.size)
        : previous.kind === "text" && previous.edges
          ? firstBaseline - previous.edges.last.y - pitch
          : 0;
  } else if (item.kind === "table") {
    extra =
      bottom !== null
        ? item.table.y - BEFORE_TABLE - bottom
        : previous.kind === "text" && previous.edges
          ? item.table.y - BEFORE_TABLE - (previous.edges.last.y + LINE_DESCENT * previous.size)
          : 0;
  } else return { blanks: 0, before: 0 };
  const blanks = Math.max(0, Math.floor(extra / pitch + (1 - BLANK_LINE_SHARE)));
  // A remainder within the line height's own tolerance is measuring noise, not space the writer left.
  const rest = extra - blanks * pitch;
  return { blanks, before: rest > pitch * LEADING_TOLERANCE ? rest : 0 };
}

/**
 * The line pitch for a cell paragraph in Word. Hangul word processors put line spacing between lines only, so a
 * block of n lines is (n - 1) pitches plus one line, while Word gives every line, the last too, a full pitch.
 * For text from such a program, spreading the block over n lines keeps rows as tall as they were. Text from Word
 * (which breaks lines anywhere) already follows Word's rule. The extra line comes once per cell, so only the cell's
 * first paragraph of several lines (`spread`) takes it up; the others keep the source's pitch.
 */
export function cellPitch(item: CellParagraph, wrap: Wrap, spread = true): number | null | undefined {
  if (wrap === "anywhere" || !item.pitch || !item.edges || !spread) return item.pitch;
  const lines = Math.round((item.edges.last.y - item.edges.first.y) / item.pitch) + 1;
  return lines > 1 ? ((lines - 1) * item.pitch + item.size) / lines : item.pitch;
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
type RunOptions = { bold?: boolean; size: number; font: string; characterSpacing?: number };

/** Text runs for a paragraph, with Word tabs where the text has a tab (a dot leader to a page number). */
function textRuns(d: Docx, text: string, options: RunOptions): InstanceType<Docx["TextRun"]>[] {
  return text.split("\t").flatMap((part, i) => [
    // Letter spacing would squeeze or spread the leader's dots too.
    ...(i ? [new d.TextRun({ ...options, characterSpacing: undefined, children: [new d.Tab()] })] : []),
    ...(part ? [new d.TextRun({ ...options, text: part })] : []),
  ]);
}

/** A right-aligned tab stop with the leader, `position` twips from the paragraph's left margin. */
function leaderStop(d: Docx, tab: Leader | undefined, position: number) {
  if (!tab) return undefined;
  const leader = { dot: d.LeaderType.DOT, middleDot: d.LeaderType.MIDDLE_DOT, hyphen: d.LeaderType.HYPHEN, underscore: d.LeaderType.UNDERSCORE }[tab.leader];
  return [{ type: d.TabStopType.RIGHT, position: Math.max(0, Math.round(position)), leader }];
}

/** The part of a line to measure letter spacing from: the text before a leader, whose dots are stretched. */
const spacingSample = (line?: Line) => (line?.tab ? line.tab.before : line);

/** indent is how far the table sits right of its column's edge, in points. */
function tableToDocx(
  d: Docx,
  block: TableBlock,
  maxWidth: number,
  centered: boolean,
  set: Typesetting,
  indent = 0,
): InstanceType<Docx["Table"]> {
  const scale = Math.min(1, maxWidth / (block.width * TWIPS_PER_POINT));
  const twips = (points: number) => Math.max(1, Math.round(points * TWIPS_PER_POINT * scale));
  const line = { style: d.BorderStyle.SINGLE, size: 4, color: "000000" };
  const none = { style: d.BorderStyle.NIL, size: 0, color: "auto" };
  const padding = twips(block.padding);

  const cellToDocx = (cell: Cell) => {
    const width = twips(block.columns.slice(cell.col, cell.col + cell.colSpan).reduce((a, b) => a + b, 0));
    // A line that fitted in the source cell must fit here too, so a narrow cell gives up padding for its widest line.
    // Measured from where the text starts furthest left, since indented lines must fit with their indent.
    const edges = cell.items.flatMap((item) => (item.kind === "text" && item.edges ? [item.edges.first, item.edges.last] : []));
    const textLeft = edges.length ? Math.min(...edges.map((line) => line.x)) : cell.x;
    const widest = edges.length
      ? Math.max(...edges.map((line) => line.x + line.width)) - Math.min(...edges.map((line) => line.x))
      : 0;
    const cellPadding = Math.max(0, Math.min(padding, Math.floor((width - twips(widest)) / 2)));
    const blank = (size: number, pitch: number | null | undefined) =>
      new d.Paragraph({
        spacing: { before: 0, after: 0, ...set.leading(size, pitch) },
        // An empty paragraph is as tall as its paragraph mark, so the mark carries the font and size.
        run: { size: Math.round(size * 2), font: DOCUMENT_FONT },
        children: [],
      });
    // The cell's first paragraph of several lines takes up Word's extra line (see cellPitch).
    const spreadAt = cell.items.findIndex((item) => item.kind === "text" && !!item.pitch);
    const pitchOf = (item: CellParagraph) => cellPitch(item, block.wrap, cell.items.indexOf(item) === spreadAt);
    const children: DocxChild[] = cell.items.flatMap((item, index) => {
      const previous = cell.items[index - 1];
      const lead = item.kind === "text" ? set.leading(item.size, pitchOf(item)) : undefined;
      const advance = item.kind === "text" ? (lead ? lead.line / TWIPS_PER_POINT : NATURAL_LINE * item.size) : undefined;
      const { blanks, before } = previous ? gapBefore(previous, item, set.ratio, advance) : { blanks: 0, before: 0 };
      const sized = item.kind === "text" ? item : previous?.kind === "text" ? previous : null;
      const lines = Array.from({ length: blanks }, () => blank(sized?.size ?? 10, sized?.pitch));
      return [...lines, cellItemToDocx(item, before)];
    });
    // before is the space the source left above the item beyond Word's own line spacing, in points.
    function cellItemToDocx(item: CellItem, before = 0): DocxChild {
      return item.kind === "table"
        ? tableToDocx(d, item.table, width - padding * 2, false, set)
        : new d.Paragraph({
            alignment: item.align,
            // Indents from where the lines start, measured from the cell's leftmost line: the structure between
            // lines ("① …", "- …" under it), not the slack a narrow cell needs for Word's wider glyphs.
            indent:
              item.align === "left" && item.edges
                ? indentOf(
                    {
                      firstX: item.edges.first.x,
                      restX: item.edges.last !== item.edges.first ? item.edges.last.x : null,
                    } as Paragraph,
                    textLeft,
                  )
                : undefined,
            spacing: { before: before > 0 ? twips(before) : 0, after: 0, ...set.leading(item.size, pitchOf(item)) },
            tabStops: leaderStop(d, item.edges?.last.tab, twips((item.edges?.last.tab?.right ?? 0) - cell.x) - cellPadding),
            children: textRuns(d, item.text, {
              bold: item.bold,
              size: Math.round(item.size * 2),
              font: DOCUMENT_FONT,
              characterSpacing: set.tracking(item.size, spacingSample(item.edges?.last)),
            }),
          });
    }
    // Word requires every cell to end with a paragraph.
    if (children.length === 0 || cell.items.at(-1)?.kind === "table") children.push(new d.Paragraph({}));
    return new d.TableCell({
      children,
      rowSpan: cell.rowSpan,
      columnSpan: cell.colSpan,
      width: { size: width, type: d.WidthType.DXA },
      verticalAlign: cell.vAlign,
      ...(cellPadding < padding ? { margins: { left: cellPadding, right: cellPadding, top: 0, bottom: 0 } } : {}),
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
    ? findTables(page.runs, page.shapes.lines, page.shapes.fills, page.wrap, page)
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
        // The widest thing in a column is always in its middle; like a paragraph, a table is centered only when it
        // also stands clear of the column's left edge.
        centered: Math.abs(middle(table) - center) < CENTER_TOLERANCE && table.x - span.left > CENTER_TOLERANCE,
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
      ? after.table.y - BEFORE_TABLE
      : after.paragraph.y + after.paragraph.size - after.paragraph.size * LINE_ASCENT;
  return {
    before: before && "table" in before ? twips(top - (before.table.y + before.table.height + AFTER_TABLE)) : 0,
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
  // Paragraph marks without a font of their own (the paragraph Word requires after a nested table) set their line
  // in Malgun Gothic like the text, not in Word's default font.
  const font = `<w:rFonts w:ascii="${DOCUMENT_FONT}" w:eastAsia="${DOCUMENT_FONT}" w:hAnsi="${DOCUMENT_FONT}" w:cs="${DOCUMENT_FONT}"/>`;
  files["word/styles.xml"] = strToU8(
    styles
      .replace(/<w:pPrDefault\/>|<w:pPrDefault>[\s\S]*?<\/w:pPrDefault>/, pPrDefault)
      .replace("<w:rPrDefault><w:rPr>", `<w:rPrDefault><w:rPr>${font}`),
  );
  return new Blob([zipSync(files)], { type: MIME.docx });
}

/** Pages in a row that share a page size and column layout become one Word section. */
type Section = { pages: number[]; columns: number; geometry: PageGeometry; columnWidth: number; space: number };
const MIN_COLUMN_SPACE = 12;

/**
 * Groups pages into sections by page size and number of columns. Pages without text join the section before them
 * when they are the same size. Each page size gets the margins measured over all its pages, so that portrait and
 * landscape pages in one document each keep theirs. Two columns are laid out as Word columns of equal width,
 * separated by the narrowest gap the pages leave between them.
 */
function sectionsOf(pages: PageContent[], flows: PageFlow[], tables: TableBlock[][]): Section[] {
  const sameSize = (a: PageContent, b: PageContent) => Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
  const geometries = new Map<PageContent, PageGeometry>();
  const geometryOf = (page: PageContent) => {
    const known = [...geometries].find(([other]) => sameSize(other, page));
    if (known) return known[1];
    const indexes = pages.flatMap((other, index) => (sameSize(other, page) ? [index] : []));
    const geometry = pageGeometry(
      indexes.map((index) => pages[index]),
      indexes.map((index) => tables[index]),
    );
    // A size with no text to measure keeps its own size with default margins.
    const sized = geometry === DEFAULT_PAGE ? { ...DEFAULT_PAGE, width: page.width, height: page.height } : geometry;
    geometries.set(page, sized);
    return sized;
  };

  const sections: Section[] = [];
  flows.forEach((flow, index) => {
    const columns = flow.columns.length;
    const last = sections.at(-1);
    const fits = last && sameSize(pages[last.pages[0]], pages[index]);
    if (last && fits && (last.columns === columns || flow.items.length === 0)) last.pages.push(index);
    else {
      const geometry = geometryOf(pages[index]);
      const contentWidth = geometry.width - geometry.left - geometry.right;
      sections.push({ pages: [index], columns, geometry, columnWidth: contentWidth, space: 0 });
    }
  });
  for (const section of sections) {
    const contentWidth = section.geometry.width - section.geometry.left - section.geometry.right;
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

export async function toDocx(source: PageContent[]): Promise<Blob> {
  const d = await import("docx");
  // Two pages printed on one sheet become two pages again, and page numbers go to the footer as a field.
  const { pages, numbers } = takePageNumbers(unimpose(source));
  const footer =
    numbers &&
    new d.Footer({
      children: [
        new d.Paragraph({
          alignment: numbers.align,
          children: [
            new d.TextRun({
              children: [numbers.prefix, d.PageNumber.CURRENT, numbers.suffix],
              size: Math.round(numbers.size * 2),
              font: DOCUMENT_FONT,
            }),
          ],
        }),
      ],
    });
  const flows = pages.map(pageFlow);
  const wrap = pages.find((page) => page.wrap)?.wrap ?? "words";
  // Body text and table cells are often set differently, so each gets its own typical spacing.
  const body = typesetting(flows.flatMap((flow) => flow.items.flatMap((item) => ("table" in item ? [] : [item.paragraph]))));
  const cells = typesetting(
    flows.flatMap((flow) => flow.items.flatMap((item) => ("table" in item ? cellParagraphsOf(item.table) : []))),
  );
  // Measured before tables are joined across pages, which changes their heights.
  const sections = sectionsOf(
    pages,
    flows,
    flows.map((flow) => flow.items.flatMap((item) => ("table" in item ? [item.table] : []))),
  );
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
          // The paragraph that separates them is 1pt tall, so it does not push the table down a whole line.
          if (pageBreak || columnBreak || previousWasTable) {
            children.push(
              new d.Paragraph({
                pageBreakBefore: pageBreak,
                spacing: { before: 0, after: 0, line: TWIPS_PER_POINT, lineRule: d.LineRuleType.EXACT },
                children: columnBreak ? [new d.ColumnBreak()] : [],
              }),
            );
          }
          const indent = item.centered ? 0 : item.table.x - item.left;
          children.push(
            tableToDocx(d, item.table, width - Math.max(0, indent) * TWIPS_PER_POINT, item.centered, cells, indent),
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
              ...body.leading(paragraph.size, paragraph.pitch),
            },
            tabStops: leaderStop(
              d,
              paragraph.tab,
              Math.min(width, ((paragraph.tab?.right ?? 0) - item.left) * TWIPS_PER_POINT),
            ),
            children: [
              ...(columnBreak ? [new d.ColumnBreak()] : []),
              ...textRuns(d, paragraph.text, {
                bold: paragraph.bold,
                size: Math.round(paragraph.size * 2),
                font: DOCUMENT_FONT,
                characterSpacing: body.tracking(paragraph.size, paragraph.last),
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
          size: { width: twips(section.geometry.width), height: twips(section.geometry.height) },
          margin: {
            top: twips(section.geometry.top),
            right: twips(section.geometry.right),
            bottom: twips(section.geometry.bottom),
            left: twips(section.geometry.left),
            // Word measures the footer from the page's bottom edge to the bottom of its line.
            ...(numbers ? { footer: twips(Math.max(0, numbers.baselineFromBottom - numbers.size * LINE_DESCENT)) } : {}),
          },
          ...(numbers && index === 0 ? { pageNumbers: { start: numbers.start } } : {}),
        },
        ...(section.columns > 1 ? { column: { count: 2, space: twips(section.space), equalWidth: true } } : {}),
      },
      ...(footer ? { footers: { default: footer } } : {}),
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
