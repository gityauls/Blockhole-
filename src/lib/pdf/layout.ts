import type { Shapes } from "./shapes";

/** One piece of text from a PDF page, measured in points from the top left. */
export type TextRun = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
};

export type Line = {
  text: string;
  x: number;
  y: number;
  width: number;
  size: number;
  bold: boolean;
  runs: TextRun[];
};

/** y is the top of the paragraph's first line; x and width span all its lines. */
export type Paragraph = { text: string; size: number; bold: boolean; y: number; x: number; width: number };

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

const dominant = <T>(runs: TextRun[], value: (run: TextRun) => T): T => {
  const longest = runs.reduce((best, run) => (run.text.length > best.text.length ? run : best));
  return value(longest);
};

function toLine(runs: TextRun[]): Line {
  const sorted = [...runs].sort((a, b) => a.x - b.x);
  let text = "";
  let end = sorted[0].x;

  for (const run of sorted) {
    const gap = run.x - end;
    if (text && gap > run.size * SPACE_GAP && !text.endsWith(" ")) text += " ";
    text += text ? run.text.replace(/^\s+/, "") : run.text.trimStart();
    end = run.x + run.width;
  }

  const right = Math.max(...sorted.map((run) => run.x + run.width));
  return {
    text: text.trimEnd(),
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

/**
 * Joins a wrapped line to the one before it. The PDF keeps no space at a line break, so whether one was there
 * depends on how the source program wraps: between words, a space was there; anywhere, only if the line
 * ended clearly short of the margin (the next word did not fit).
 */
export function joinWrapped(previous: Line, next: Line, wrap: Wrap, fullRight: number): string {
  const lastRun = previous.runs.at(-1)?.text ?? "";
  const firstRun = next.runs[0]?.text ?? "";
  const room = fullRight - (previous.x + previous.width);
  const spaced =
    /\s$/.test(lastRun) ||
    /^\s/.test(firstRun) ||
    (/[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(next.text)) ||
    (wrap === "words" ? !/[-‐]$/.test(previous.text) : room > previous.size * 0.9);
  return `${spaced ? " " : ""}${next.text}`;
}

export function groupParagraphs(lines: Line[], wrap: Wrap = "words"): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const fullRight = Math.max(0, ...lines.map((line) => line.x + line.width));
  let previous: Line | null = null;

  for (const line of lines) {
    const current = paragraphs.at(-1);
    const sizeRatio = previous ? Math.max(line.size, previous.size) / Math.min(line.size, previous.size) : 1;
    const startsNew =
      !current ||
      !previous ||
      line.y - previous.y > line.size * PARAGRAPH_GAP ||
      sizeRatio > SIZE_CHANGE ||
      line.bold !== previous.bold;

    if (startsNew) {
      paragraphs.push({ text: line.text, size: line.size, bold: line.bold, y: line.y - line.size, x: line.x, width: line.width });
    } else if (current && previous) {
      current.text += joinWrapped(previous, line, wrap, fullRight);
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
