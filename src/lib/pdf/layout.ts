import type { Shapes } from "./shapes";

/** One piece of text from a PDF page, measured in points from the top left. */
export type TextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  /**
   * The tagged-PDF span the text was written in, when the PDF puts each word in a span of its own (Word does).
   * A word broken across lines stays in one span, so this tells a break inside a word from a break at a space.
   */
  span?: number;
};

export type Line = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  runs: TextRun[];
  /** A dot leader to a right-aligned number, as in a table of contents: the text has a tab where it was. */
  tab?: Leader;
};

export type Leader = {
  /** Where the text after the leader ends, which is where a right-aligned tab stop puts it. */
  right: number;
  leader: "dot" | "middleDot" | "hyphen" | "underscore";
  /** The text before the leader and its width, set at natural spacing. */
  before: { text: string; width: number };
};

// Four or more leader characters after text, then nothing or a short page reference: dots drawn by a tab leader.
const LEADER = /^(.*?\S)\s*([·.‥…ㆍ・\-_]{4,})\s*(\S{1,12})?$/;
const LEADER_KIND: Record<string, Leader["leader"]> = { ".": "dot", "‥": "dot", "…": "dot", "-": "hyphen", _: "underscore" };

/**
 * y is the top of the paragraph's first line and bottom the baseline of its last; x and width span all its lines.
 * firstX is where the first line starts and restX where the later lines start, which give its indentation.
 * pitch is the distance between its baselines, when it has more than one line.
 */
export type Paragraph = {
  text: string;
  size: number;
  bold: boolean;
  y: number;
  bottom: number;
  x: number;
  width: number;
  firstX: number;
  restX: number | null;
  pitch: number | null;
  /** Its last line, which is set at natural width even in justified text, to measure letter spacing from. */
  last: { text: string; width: number };
  /** The leader of its last line, if it has one. */
  tab?: Leader;
};

/** Distance between the baselines of consecutive lines, or null for a single line. */
export function pitchOf(lines: Line[]): number | null {
  return lines.length > 1 ? (lines.at(-1)!.y - lines[0].y) / (lines.length - 1) : null;
}

export type PageContent = {
  width: number;
  height: number;
  runs: TextRun[];
  /** Hex text colors keyed by line index, sampled from the rendered page. */
  colors: string[];
  image?: Uint8Array;
  /** Straight lines and filled boxes the page draws, used to find tables. */
  shapes?: Shapes;
  /** How the source program broke lines: Word may break inside Korean words, Hangul and most others only between them. */
  wrap?: Wrap;
};

export type Wrap = "anywhere" | "words";

const SPACE_GAP = 0.15;
const CELL_GAP = 1.5;
const PARAGRAPH_GAP = 1.8;
const SIZE_CHANGE = 1.15;
const COLUMN_TOLERANCE = 6;
const GUTTER_SEARCH = 0.3;
const GUTTER_TOLERANCE = 0.02;
const MIN_GUTTER = 8;
const MIN_COLUMN_SHARE = 0.2;
const BLOCK_WEIGHT = 3;
// Slack for glyph widths when judging whether text would have fitted on a line, as a share of the font size.
const FIT_SLACK = 0.5;

/** A bullet, note mark, or item number that starts a new paragraph. */
export const START_MARK = /^\s*([•·▪■□○●◦※*\-–]|\(?\d{1,2}[.)]|[①-⑳]|[가-하][.)]|\([가-하]\))/;

/**
 * Whether the start of `next` would have fitted at the end of `previous`, in `room` points from where `previous`
 * starts. If it would, the source program did not wrap there: the writer broke the line on purpose. Word breaks
 * Hangul anywhere, so only one character must fit, or the Latin letters and digits it starts with ("2,4,6" of
 * "2,4,6선식(2)", which Word breaks before "선"); a program that breaks between words needs the whole first word.
 */
export function wouldFit(previous: Line, next: Line, room: number, wrap: Wrap): boolean {
  const word =
    wrap === "words"
      ? (next.text.match(/^\S+/)?.[0].length ?? 1)
      : (next.text.match(/^[A-Za-z0-9][A-Za-z0-9.,]*/)?.[0].length ?? 1);
  const token = (next.width * word) / Math.max(1, next.text.length);
  const space = wrap === "words" ? previous.size * 0.25 : 0;
  return previous.width + space + token <= room - previous.size * FIT_SLACK;
}

const dominant = <T>(runs: TextRun[], value: (run: TextRun) => T): T => {
  const longest = runs.reduce((best, run) => (run.text.length > best.text.length ? run : best));
  return value(longest);
};

function toLine(runs: TextRun[]): Line {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  let text = "";
  let end = sorted[0].x;
  // Where each run starts in the text, to find the x of any character.
  const starts: { index: number; run: TextRun; length: number }[] = [];

  for (const run of sorted) {
    const gap = run.x - end;
    if (text && gap > run.size * SPACE_GAP && !text.endsWith(" ")) text += " ";
    const piece = text ? run.text.replace(/^\s+/, "") : run.text.trimStart();
    starts.push({ index: text.length, run, length: piece.length });
    text += piece;
    end = run.x + run.width;
  }
  text = text.trimEnd();

  const right = Math.max(...sorted.map((run) => run.x + run.width));
  const xAt = (index: number) => {
    const at = starts.findLast((s) => s.index <= index) ?? starts[0];
    return at.run.x + (at.run.width * (index - at.index)) / Math.max(1, at.length);
  };
  let tab: Leader | undefined;
  const leader = text.match(LEADER);
  if (leader) {
    const dotsAt = text.indexOf(leader[2], leader[1].length);
    // The text's own width is known only when the dots start a run of their own; inside a run they are stretched
    // along with it, and the text then says nothing about its spacing.
    const ownRun = starts.some((s) => s.index === dotsAt || (s.index === dotsAt + 1 && text[dotsAt] === " "));
    tab = {
      right,
      leader: LEADER_KIND[leader[2][0]] ?? "middleDot",
      before: ownRun ? { text: leader[1], width: xAt(dotsAt) - sorted[0].x } : { text: "", width: 0 },
    };
    text = `${leader[1]}\t${leader[3] ?? ""}`;
  }
  return {
    tab,
    text,
    x: sorted[0].x,
    y: sorted[0].y,
    width: right - sorted[0].x,
    size: dominant(sorted, (run) => run.size),
    bold: dominant(sorted, (run) => run.bold),
    runs: sorted,
  };
}

/** Rebuilds visual lines, since PDFs store text in arbitrary pieces. */
export function groupLines(runs: TextRun[]): Line[] {
  const sorted = runs.filter((run) => run.text.trim()).sort((a, b) => a.y - b.y);
  const groups: TextRun[][] = [];

  for (const run of sorted) {
    const current = groups.at(-1);
    if (current && Math.abs(run.y - current[0].y) <= Math.max(1, current[0].size * 0.5)) {
      current.push(run);
    } else {
      groups.push([run]);
    }
  }

  return groups.map(toLine);
}

// Slack for glyph widths when comparing the room left on a line with a character's width, in font sizes.
const ROOM_SLACK = 0.1;

/**
 * Joins a wrapped line to the one before it. The PDF keeps no space at a line break, but the source program's
 * greedy line filling tells whether one was there. `room` is how much space the previous line left before the
 * edge of its column or cell.
 * - Latin words and numbers break inside only when one word is longer than the whole line, so a line holding a
 *   single word that continues on the next line was cut inside it ("10" / "0" is "100"); otherwise a space.
 * - Hangul from a program that breaks between words (한글): a space, unless the line ends with a hyphen.
 * - When the PDF tags each word as a span, the spans say it directly: one word across the break, or two.
 * - Hangul from Word, which breaks anywhere: if the next character would have fitted in the room left, Word would
 *   have put it there, so the line broke at a space; otherwise it broke inside a word.
 */
export function joinWrapped(previous: Line, next: Line, wrap: Wrap, room: number): string {
  const lastRun = previous.runs.at(-1)?.text ?? "";
  const firstRun = next.runs[0]?.text ?? "";
  if (/\s$/.test(lastRun) || /^\s/.test(firstRun)) return ` ${next.text}`;
  const before = previous.runs.at(-1)?.span;
  const after = next.runs[0]?.span;
  let spaced: boolean;
  // Word also starts a span where Hangul meets Latin letters or digits ("10" / "월"), so spans only speak for
  // breaks with neither side Latin.
  const latinEdge = /[A-Za-z0-9]$/.test(previous.text) || /^[A-Za-z0-9]/.test(next.text);
  if (before !== undefined && after !== undefined && !latinEdge) spaced = before !== after;
  else if (/[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(next.text)) spaced = /\s/.test(previous.text.trim());
  else if (wrap === "words") spaced = !/[-‐]$/.test(previous.text);
  else {
    const first = next.runs[0];
    const charWidth = first && first.text.length ? first.width / first.text.length : next.size;
    spaced = room >= charWidth - next.size * ROOM_SLACK;
  }
  return `${spaced ? " " : ""}${next.text}`;
}

export function groupParagraphs(lines: Line[], wrap: Wrap = "words"): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const fullRight = Math.max(0, ...lines.map((line) => line.x + line.width));
  let previous: Line | null = null;
  let lineCount = 0;

  for (const line of lines) {
    const current = paragraphs.at(-1);
    const sizeRatio = previous ? Math.max(line.size, previous.size) / Math.min(line.size, previous.size) : 1;
    const startsNew =
      !current ||
      !previous ||
      line.y - previous.y > line.size * PARAGRAPH_GAP ||
      sizeRatio > SIZE_CHANGE ||
      line.bold !== previous.bold ||
      START_MARK.test(line.text) ||
      // A line that leads to a page number ends its entry.
      previous.tab !== undefined ||
      // A line that ended before the column was full ends its paragraph.
      wouldFit(previous, line, fullRight - previous.x, wrap);

    if (startsNew) {
      paragraphs.push({
        text: line.text,
        size: line.size,
        bold: line.bold,
        y: line.y - line.size,
        bottom: line.y,
        x: line.x,
        width: line.width,
        firstX: line.x,
        restX: null,
        pitch: null,
        last: line.tab?.before ?? { text: line.text, width: line.width },
        tab: line.tab,
      });
      lineCount = 1;
    } else if (current && previous) {
      current.text += joinWrapped(previous, line, wrap, fullRight - (previous.x + previous.width));
      lineCount++;
      current.pitch = (line.y - (current.y + current.size)) / (lineCount - 1);
      current.bottom = line.y;
      current.restX = Math.min(current.restX ?? line.x, line.x);
      current.last = line.tab?.before ?? { text: line.text, width: line.width };
      current.tab = line.tab;
      const right = Math.max(current.x + current.width, line.x + line.width);
      current.x = Math.min(current.x, line.x);
      current.width = right - current.x;
    }
    previous = line;
  }

  return paragraphs;
}

/** Splits a visual line at wide gaps, which separate table cells or columns. */
function lineParts(line: Line): Line[] {
  const parts: { end: number; runs: TextRun[] }[] = [];
  for (const run of line.runs) {
    const current = parts.at(-1);
    if (current && run.x - current.end <= run.size * CELL_GAP) {
      current.runs.push(run);
      current.end = Math.max(current.end, run.x + run.width);
    } else {
      parts.push({ end: run.x + run.width, runs: [run] });
    }
  }
  return parts.map((part) => toLine(part.runs));
}

/** Every separately placed piece of text on a page, top to bottom. */
export function textBoxes(runs: TextRun[]): Line[] {
  return groupLines(runs).flatMap(lineParts);
}

/**
 * Finds a vertical gutter so side-by-side columns or book pages can be read one at a time.
 * Requires text on both sides and allows a few pieces, such as a heading, to cross it.
 */
export function splitColumns(runs: TextRun[], pageWidth: number, blocks: Box[] = []): TextRun[][] {
  const gutter = findGutter(runs, pageWidth, blocks);
  if (gutter === null) return [runs];
  const middle = (run: TextRun) => run.x + run.width / 2;
  return [runs.filter((run) => middle(run) < gutter), runs.filter((run) => middle(run) >= gutter)];
}

export type Box = { x: number; y: number; width: number; height: number };

/**
 * Returns the x of the gutter between two columns, or null for a single column.
 * Blocks such as tables count as occupied space, so a gap inside a table is never taken for a gutter.
 */
export function findGutter(runs: TextRun[], pageWidth: number, blocks: Box[] = []): number | null {
  const text = runs.filter((run) => run.text.trim());
  if (text.length === 0) return null;

  const width = Math.ceil(pageWidth);
  const crossing = new Array<number>(width + 1).fill(0);
  const spans = [...text, ...blocks];
  for (const span of spans) {
    const last = Math.min(width, Math.floor(span.x + span.width));
    for (let x = Math.max(0, Math.floor(span.x)); x <= last; x++) crossing[x]++;
  }

  const allowed = Math.floor(spans.length * GUTTER_TOLERANCE);
  const from = Math.floor(width * GUTTER_SEARCH);
  const to = Math.ceil(width * (1 - GUTTER_SEARCH));

  let best = { start: 0, length: 0 };
  let start = -1;
  for (let x = from; x <= to + 1; x++) {
    const clear = x <= to && crossing[x] <= allowed;
    if (clear && start < 0) start = x;
    if (!clear && start >= 0) {
      if (x - start > best.length) best = { start, length: x - start };
      start = -1;
    }
  }
  if (best.length < MIN_GUTTER) return null;

  const gutter = best.start + best.length / 2;
  const middle = (span: { x: number; width: number }) => span.x + span.width / 2;
  // A page of short lines also leaves the middle empty, so both sides must hold real content.
  // A table counts like several lines of text.
  const weight = (side: (span: { x: number; width: number }) => boolean) =>
    groupLines(text.filter(side)).length + blocks.filter(side).length * BLOCK_WEIGHT;
  const total = weight(() => true);
  const enough = Math.max(2, total * MIN_COLUMN_SHARE);
  const left = weight((span) => middle(span) < gutter);
  const right = weight((span) => middle(span) >= gutter);
  return left >= enough && right >= enough ? gutter : null;
}

/** Lines text up into a grid using the left edge of each block of text. */
export function tableRows(lines: Line[]): string[][] {
  const rows = lines.map(lineParts);

  const columns: number[] = [];
  for (const x of rows.flat().map((cell) => cell.x).sort((a, b) => a - b)) {
    const last = columns.at(-1);
    if (last === undefined || x - last > COLUMN_TOLERANCE) columns.push(x);
  }

  return rows.map((cells) => {
    const row: string[] = new Array(columns.length).fill("");
    for (const cell of cells) {
      let column = 0;
      columns.forEach((x, index) => {
        if (Math.abs(x - cell.x) < Math.abs(columns[column] - cell.x)) column = index;
      });
      row[column] = row[column] ? `${row[column]} ${cell.text}` : cell.text;
    }
    return row;
  });
}

/** Stores real numbers as numbers, but leaves codes such as 007 as text. */
export function cellValue(text: string): string | number {
  const trimmed = text.trim();
  if (!/^-?(0|[1-9]\d{0,2}(,\d{3})+|[1-9]\d*)(\.\d+)?$/.test(trimmed)) return text;
  return Number(trimmed.replaceAll(",", ""));
}
