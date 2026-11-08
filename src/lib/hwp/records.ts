/**
 * Reads the parts of an HWP 5.0 document that layout depends on, following Hancom's published format
 * ("한글 문서 파일 형식 5.0"). Lengths are in HWPUNIT, 1/7200 inch, so points are HWPUNIT / 100.
 */
import { inflateSync } from "fflate";
import { readCfb } from "./cfb";

const TAG = {
  CHAR_SHAPE: 21,
  PARA_SHAPE: 25,
  PARA_HEADER: 66,
  PARA_TEXT: 67,
  PARA_CHAR_SHAPE: 68,
  PARA_LINE_SEG: 69,
  CTRL_HEADER: 71,
  LIST_HEADER: 72,
  PAGE_DEF: 73,
  TABLE: 77,
} as const;

type Record = { tag: number; level: number; data: Uint8Array };

export type CharShape = {
  /** Font size in points. */
  size: number;
  /** Width scaling (장평) and letter spacing (자간) in percent, for Hangul text. */
  ratio: number;
  spacing: number;
  bold: boolean;
};

export type ParaShape = {
  /** Line spacing kind: percent of the font size, fixed, or space between lines only. */
  lineKind: "percent" | "fixed" | "between" | "atLeast";
  /** Percent for "percent", otherwise points. */
  lineSpacing: number;
  /** Space before and after, and indents, in points. */
  before: number;
  after: number;
  left: number;
  indent: number;
};

/** One laid-out line: its top, height and baseline in points from the top of its text area, as 한글 placed it. */
export type LineSeg = { start: number; top: number; height: number; textHeight: number; baseline: number; spacing: number };

export type HwpParagraph = {
  text: string;
  paraShape: number;
  /** Character shape ids, each from the character position it starts at. */
  charShapes: { start: number; id: number }[];
  lines: LineSeg[];
  /** Controls in this paragraph, such as tables ("tbl ") and page numbers ("pgnp"). */
  controls: HwpControl[];
};

export type HwpTable = { rows: number; cols: number; cells: HwpCell[] };
export type HwpCell = { row: number; col: number; rowSpan: number; colSpan: number; width: number; height: number; paragraphs: HwpParagraph[] };
export type HwpControl = { id: string; table?: HwpTable };
export type PageDef = { width: number; height: number; left: number; right: number; top: number; bottom: number; header: number; footer: number; landscape: boolean };

export type HwpDocument = { charShapes: CharShape[]; paraShapes: ParaShape[]; sections: { page?: PageDef; paragraphs: HwpParagraph[] }[] };

function records(bytes: Uint8Array): Record[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record[] = [];
  for (let offset = 0; offset + 4 <= bytes.length; ) {
    const header = view.getUint32(offset, true);
    offset += 4;
    let size = header >>> 20;
    if (size === 0xfff) {
      size = view.getUint32(offset, true);
      offset += 4;
    }
    out.push({ tag: header & 0x3ff, level: (header >>> 10) & 0x3ff, data: bytes.subarray(offset, offset + size) });
    offset += size;
  }
  return out;
}

const dataView = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const points = (hwpunit: number) => hwpunit / 100;

// Control characters take one code unit ("char" kind) or eight (inline and extended kinds).
const SHORT_CONTROLS = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

function paragraphText(data: Uint8Array): string {
  const view = dataView(data);
  let text = "";
  for (let i = 0; i + 2 <= data.length; ) {
    const code = view.getUint16(i, true);
    if (code >= 32) text += String.fromCharCode(code);
    else if (code === 13 || code === 10) text += "\n";
    else if (code === 9) text += "\t";
    i += code < 32 && !SHORT_CONTROLS.has(code) ? 16 : 2;
  }
  return text.replace(/\n$/, "");
}

function charShape(data: Uint8Array): CharShape {
  const view = dataView(data);
  // Seven languages each: font ids (2 bytes), ratio, spacing, relative size, offset. Hangul comes first.
  const attributes = view.getUint32(46, true);
  return { ratio: data[14], spacing: view.getInt8(21), size: view.getInt32(42, true) / 100, bold: (attributes & 2) !== 0 };
}

function paraShape(data: Uint8Array): ParaShape {
  const view = dataView(data);
  const kinds = ["percent", "fixed", "between", "atLeast"] as const;
  // 5.0.2.5 and later keep the kind and value in the last fields; earlier files in the first.
  const modern = data.length >= 54;
  const kind = modern ? view.getUint32(46, true) & 0x1f : view.getUint32(0, true) & 3;
  const value = modern ? view.getUint32(50, true) : view.getInt32(24, true);
  const lineKind = kinds[kind] ?? "percent";
  return {
    lineKind,
    lineSpacing: lineKind === "percent" ? value : points(value),
    left: points(view.getInt32(4, true)),
    indent: points(view.getInt32(12, true)),
    before: points(view.getInt32(16, true)),
    after: points(view.getInt32(20, true)),
  };
}

function lineSegs(data: Uint8Array): LineSeg[] {
  const view = dataView(data);
  const lines: LineSeg[] = [];
  for (let offset = 0; offset + 36 <= data.length; offset += 36) {
    lines.push({
      start: view.getUint32(offset, true),
      top: points(view.getInt32(offset + 4, true)),
      height: points(view.getInt32(offset + 8, true)),
      textHeight: points(view.getInt32(offset + 12, true)),
      baseline: points(view.getInt32(offset + 16, true)),
      spacing: points(view.getInt32(offset + 20, true)),
    });
  }
  return lines;
}

const ctrlId = (data: Uint8Array) => String.fromCharCode(data[3], data[2], data[1], data[0]);

/** Builds paragraphs from a run of records, with tables and their cells nested inside. */
function paragraphs(list: Record[], from: number, level: number): { paragraphs: HwpParagraph[]; next: number; page?: PageDef } {
  const out: HwpParagraph[] = [];
  let page: PageDef | undefined;
  let i = from;
  while (i < list.length && list[i].level >= level) {
    const record = list[i];
    // Another record at this level, such as the next cell's list header, ends this paragraph list.
    if (record.level === level && record.tag !== TAG.PARA_HEADER) break;
    if (record.level !== level) {
      i++;
      continue;
    }
    const paragraph: HwpParagraph = { text: "", paraShape: dataView(record.data).getUint16(8, true), charShapes: [], lines: [], controls: [] };
    out.push(paragraph);
    i++;
    while (i < list.length && list[i].level > level) {
      const child = list[i];
      if (child.level === level + 1 && child.tag === TAG.PARA_TEXT) paragraph.text = paragraphText(child.data);
      else if (child.level === level + 1 && child.tag === TAG.PARA_CHAR_SHAPE) {
        const view = dataView(child.data);
        for (let o = 0; o + 8 <= child.data.length; o += 8) paragraph.charShapes.push({ start: view.getUint32(o, true), id: view.getUint32(o + 4, true) });
      } else if (child.level === level + 1 && child.tag === TAG.PARA_LINE_SEG) paragraph.lines = lineSegs(child.data);
      else if (child.level === level + 1 && child.tag === TAG.CTRL_HEADER) {
        const control: HwpControl = { id: ctrlId(child.data) };
        paragraph.controls.push(control);
        i++;
        if (control.id === "tbl ") {
          const parsed = table(list, i, level + 2);
          control.table = parsed.table;
          i = parsed.next;
        } else {
          // Section definitions hold the page size; other controls are skipped with their children.
          while (i < list.length && list[i].level > level + 1) {
            if (list[i].tag === TAG.PAGE_DEF && !page) page = pageDef(list[i].data);
            i++;
          }
        }
        continue;
      }
      i++;
    }
  }
  return { paragraphs: out, next: i, page };
}

function table(list: Record[], from: number, level: number): { table: HwpTable; next: number } {
  let i = from;
  const result: HwpTable = { rows: 0, cols: 0, cells: [] };
  while (i < list.length && list[i].level >= level) {
    const record = list[i];
    if (record.tag === TAG.TABLE && record.level === level) {
      const view = dataView(record.data);
      result.rows = view.getUint16(4, true);
      result.cols = view.getUint16(6, true);
      i++;
    } else if (record.tag === TAG.LIST_HEADER && record.level === level) {
      const view = dataView(record.data);
      // A cell: its paragraph list header, then column, row, spans, size, margins, border fill.
      const cell: HwpCell = {
        col: view.getUint16(8, true),
        row: view.getUint16(10, true),
        colSpan: view.getUint16(12, true),
        rowSpan: view.getUint16(14, true),
        width: points(view.getUint32(16, true)),
        height: points(view.getUint32(20, true)),
        paragraphs: [],
      };
      const parsed = paragraphs(list, i + 1, level);
      cell.paragraphs = parsed.paragraphs;
      result.cells.push(cell);
      i = parsed.next;
    } else i++;
  }
  return { table: result, next: i };
}

function pageDef(data: Uint8Array): PageDef {
  const view = dataView(data);
  const value = (offset: number) => points(view.getUint32(offset, true));
  return {
    width: value(0),
    height: value(4),
    left: value(8),
    right: value(12),
    top: value(16),
    bottom: value(20),
    header: value(24),
    footer: value(28),
    landscape: (view.getUint32(36, true) & 1) === 1,
  };
}

export function readHwp(bytes: Uint8Array): HwpDocument {
  const file = readCfb(bytes);
  const header = file.read("FileHeader");
  if (!header) throw new Error("HWP 파일 헤더가 없습니다.");
  const flags = dataView(header).getUint32(36, true);
  if (flags & 2) throw new Error("암호가 걸린 HWP 파일입니다.");
  if (flags & 4) throw new Error("배포용 HWP 파일은 아직 읽지 못합니다.");
  const compressed = (flags & 1) === 1;
  const stream = (path: string) => {
    const raw = file.read(path);
    if (!raw) return null;
    return compressed ? inflateSync(raw) : raw;
  };

  const info = records(stream("DocInfo") ?? new Uint8Array());
  const charShapes = info.filter((r) => r.tag === TAG.CHAR_SHAPE).map((r) => charShape(r.data));
  const paraShapes = info.filter((r) => r.tag === TAG.PARA_SHAPE).map((r) => paraShape(r.data));

  const sections: HwpDocument["sections"] = [];
  for (let index = 0; ; index++) {
    const body = stream(`BodyText/Section${index}`);
    if (!body) break;
    const parsed = paragraphs(records(body), 0, 0);
    sections.push({ page: parsed.page, paragraphs: parsed.paragraphs });
  }
  return { charShapes, paraShapes, sections };
}
