import { type Line, START_MARK, type TextRun, type Wrap, groupLines, joinWrapped, pitchOf, wouldFit } from "./layout";
import type { Fill, Segment } from "./shapes";

export type Align = "left" | "center" | "right";
export type VAlign = "top" | "center" | "bottom";

export type CellParagraph = {
  kind: "text";
  y: number;
  text: string;
  size: number;
  bold: boolean;
  align: Align;
  /** Its first and last lines on the page, to tell whether a page break cut it. */
  edges?: { first: Line; last: Line };
  /** Distance between its baselines, when it has more than one line. */
  pitch?: number | null;
};
export type CellTable = { kind: "table"; y: number; table: TableBlock };
export type CellItem = CellParagraph | CellTable;

export type Cell = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  x: number;
  y: number;
  width: number;
  height: number;
  items: CellItem[];
  vAlign: VAlign;
  shade?: string;
  borders: { top: boolean; bottom: boolean; left: boolean; right: boolean };
};

/** A table found from the lines a page draws. Cells are listed once, at their top-left grid position. */
export type TableBlock = {
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number[];
  rows: number[];
  cells: Cell[];
  /** Leading rows Word should repeat on every page, found when a table continues across pages. */
  headerRows?: number;
  /** Space between a cell's left or right edge and its text, measured from the page. */
  padding: number;
  /** How the source program broke lines in the table's cells. */
  wrap: Wrap;
  /**
   * Rows a page break cut in two and that were joined again. Their measured height spans both pages, so Word must
   * size them by their content alone, or it cannot break them across pages as the source did.
   */
  joinedRows?: number[];
};

const TOLERANCE = 2;
const MIN_TRACK = 4;
const MIN_LINE = 4;
const MIN_TABLE_WIDTH = 20;
const MIN_TABLE_HEIGHT = 8;
const MAX_BOX_LINES = 15;
const SHADE_COVER = 0.7;
const PARAGRAPH_PITCH = 1.9;
const SHORT_LABEL_LINES = 3;
// Word's default left and right cell padding, used when a table holds no text to measure it from.
const DEFAULT_PADDING = 5.4;
const MAX_PADDING = 10;

type Horizontal = { y: number; x1: number; x2: number };
type Vertical = { x: number; y1: number; y2: number };

/** Joins pieces of the same line: same position (within tolerance) and touching or overlapping. */
function mergeCollinear<T>(items: T[], at: (t: T) => number, from: (t: T) => number, to: (t: T) => number, make: (at: number, from: number, to: number) => T): T[] {
  // Group by position first; sorting by position alone would interleave lines from different tables.
  const byPosition = [...items].sort((p, q) => at(p) - at(q));
  const groups: T[][] = [];
  for (const item of byPosition) {
    const group = groups.at(-1);
    if (group && at(item) - at(group[0]) <= TOLERANCE) group.push(item);
    else groups.push([item]);
  }
  const merged: T[] = [];
  for (const group of groups) {
    const position = group.reduce((sum, item) => sum + at(item), 0) / group.length;
    let current: { from: number; to: number } | null = null;
    for (const item of group.sort((p, q) => from(p) - from(q))) {
      if (current && from(item) <= current.to + TOLERANCE) current.to = Math.max(current.to, to(item));
      else {
        if (current) merged.push(make(position, current.from, current.to));
        current = { from: from(item), to: to(item) };
      }
    }
    if (current) merged.push(make(position, current.from, current.to));
  }
  return merged;
}

function splitLines(segments: Segment[]) {
  const horizontals: Horizontal[] = [];
  const verticals: Vertical[] = [];
  for (const { x1, y1, x2, y2 } of segments) {
    if (Math.abs(y2 - y1) <= TOLERANCE && Math.abs(x2 - x1) >= MIN_LINE) {
      horizontals.push({ y: (y1 + y2) / 2, x1: Math.min(x1, x2), x2: Math.max(x1, x2) });
    } else if (Math.abs(x2 - x1) <= TOLERANCE && Math.abs(y2 - y1) >= MIN_LINE) {
      verticals.push({ x: (x1 + x2) / 2, y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
    }
  }
  return {
    horizontals: mergeCollinear(horizontals, (h) => h.y, (h) => h.x1, (h) => h.x2, (y, x1, x2) => ({ y, x1, x2 })),
    verticals: mergeCollinear(verticals, (v) => v.x, (v) => v.y1, (v) => v.y2, (x, y1, y2) => ({ x, y1, y2 })),
  };
}

const crosses = (h: Horizontal, v: Vertical) =>
  v.x >= h.x1 - TOLERANCE && v.x <= h.x2 + TOLERANCE && h.y >= v.y1 - TOLERANCE && h.y <= v.y2 + TOLERANCE;

/** Groups lines that touch into separate tables. */
function components(horizontals: Horizontal[], verticals: Vertical[]) {
  const parent = Array.from({ length: horizontals.length + verticals.length }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  horizontals.forEach((h, i) =>
    verticals.forEach((v, j) => {
      if (crosses(h, v)) parent[find(i)] = find(horizontals.length + j);
    }),
  );
  const groups = new Map<number, { horizontals: Horizontal[]; verticals: Vertical[] }>();
  const group = (i: number) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, { horizontals: [], verticals: [] });
    return groups.get(root)!;
  };
  horizontals.forEach((h, i) => group(i).horizontals.push(h));
  verticals.forEach((v, j) => group(horizontals.length + j).verticals.push(v));
  return [...groups.values()];
}

/** Clusters nearby coordinates and drops tracks too thin to hold text, such as double borders. */
function tracks(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const value of sorted) {
    const last = clusters.at(-1);
    if (last && value - last.at(-1)! <= TOLERANCE) last.push(value);
    else clusters.push([value]);
  }
  const centers = clusters.map((c) => c.reduce((a, b) => a + b, 0) / c.length);
  const kept: number[] = [];
  centers.forEach((value, index) => {
    if (kept.length && value - kept.at(-1)! < MIN_TRACK) {
      if (index === centers.length - 1) kept[kept.length - 1] = value;
    } else {
      kept.push(value);
    }
  });
  return kept;
}

const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

function hasVertical(verticals: Vertical[], x: number, y: number) {
  return verticals.some((v) => near(v.x, x) && y >= v.y1 - TOLERANCE && y <= v.y2 + TOLERANCE);
}

function hasHorizontal(horizontals: Horizontal[], y: number, x: number) {
  return horizontals.some((h) => near(h.y, y) && x >= h.x1 - TOLERANCE && x <= h.x2 + TOLERANCE);
}

type Grid = { xs: number[]; ys: number[]; cells: Omit<Cell, "items" | "vAlign">[] };

function buildGrid(horizontals: Horizontal[], verticals: Vertical[]): Grid | null {
  const xs = tracks([...verticals.map((v) => v.x), ...horizontals.flatMap((h) => [h.x1, h.x2])]);
  const ys = tracks([...horizontals.map((h) => h.y), ...verticals.flatMap((v) => [v.y1, v.y2])]);
  const rows = ys.length - 1;
  const cols = xs.length - 1;
  if (rows < 1 || cols < 1) return null;
  if (xs[cols] - xs[0] < MIN_TABLE_WIDTH || ys[rows] - ys[0] < MIN_TABLE_HEIGHT) return null;

  const parent = Array.from({ length: rows * cols }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const join = (a: number, b: number) => (parent[find(a)] = find(b));
  for (let r = 0; r < rows; r++) {
    const middleY = (ys[r] + ys[r + 1]) / 2;
    for (let c = 0; c < cols; c++) {
      const middleX = (xs[c] + xs[c + 1]) / 2;
      if (c + 1 < cols && !hasVertical(verticals, xs[c + 1], middleY)) join(r * cols + c, r * cols + c + 1);
      if (r + 1 < rows && !hasHorizontal(horizontals, ys[r + 1], middleX)) join(r * cols + c, (r + 1) * cols + c);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < rows * cols; i++) {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), i]);
  }

  const cells: Grid["cells"] = [];
  const add = (row: number, col: number, rowSpan: number, colSpan: number) => {
    const x = xs[col];
    const y = ys[row];
    const width = xs[col + colSpan] - x;
    const height = ys[row + rowSpan] - y;
    cells.push({
      row, col, rowSpan, colSpan, x, y, width, height,
      borders: {
        top: hasHorizontal(horizontals, y, x + width / 2),
        bottom: hasHorizontal(horizontals, y + height, x + width / 2),
        left: hasVertical(verticals, x, y + height / 2),
        right: hasVertical(verticals, x + width, y + height / 2),
      },
    });
  };
  for (const members of groups.values()) {
    const rs = members.map((i) => Math.floor(i / cols));
    const cs = members.map((i) => i % cols);
    const [r0, r1, c0, c1] = [Math.min(...rs), Math.max(...rs), Math.min(...cs), Math.max(...cs)];
    // A region that is not a rectangle cannot be one merged cell, so keep its grid cells apart.
    if ((r1 - r0 + 1) * (c1 - c0 + 1) === members.length) add(r0, c0, r1 - r0 + 1, c1 - c0 + 1);
    else members.forEach((i) => add(Math.floor(i / cols), i % cols, 1, 1));
  }
  cells.sort((a, b) => a.row - b.row || a.col - b.col);
  return { xs, ys, cells };
}

const center = (run: TextRun): [number, number] => [run.x + run.width / 2, run.y - run.size / 2];
const inside = (x: number, y: number, box: { x: number; y: number; width: number; height: number }) =>
  x >= box.x - TOLERANCE && x <= box.x + box.width + TOLERANCE && y >= box.y - TOLERANCE && y <= box.y + box.height + TOLERANCE;

function alignOf(lines: Line[], cell: { x: number; width: number }): Align {
  const gaps = lines.map((line) => [line.x - cell.x, cell.x + cell.width - (line.x + line.width)]);
  // Equal space on both sides of every line means centered; the allowance grows with the free space.
  const balanced = ([left, right]: number[]) => Math.abs(left - right) <= Math.max(1.5, (left + right) * 0.15);
  if (gaps.every(balanced)) {
    // Long text that fills the cell looks balanced either way; call it centered only when a line is clearly short.
    // Short labels of a few lines are usually centered.
    const free = gaps.map(([left, right]) => left + right);
    if (lines.length <= SHORT_LABEL_LINES || Math.max(...free) - Math.min(...free) > lines[0].size) return "center";
  }
  const left = Math.min(...lines.map((line) => line.x));
  if (lines.every((line) => line.x - left <= TOLERANCE)) return "left";
  const right = Math.max(...lines.map((line) => line.x + line.width));
  return lines.every((line) => right - (line.x + line.width) <= TOLERANCE) ? "right" : "left";
}

/** The cell padding is the smallest gap between a cell's left edge and any of its lines. */
function paddingOf(cells: { x: number }[], cellLines: Line[][]): number {
  const gaps = cells.flatMap((cell, c) => cellLines[c].map((line) => line.x - cell.x)).filter((gap) => gap >= 0);
  return gaps.length ? Math.min(MAX_PADDING, Math.max(0.5, Math.min(...gaps))) : DEFAULT_PADDING;
}


function cellParagraphs(lines: Line[], cell: { x: number; width: number }, wrap: Wrap, padding: number): CellParagraph[] {
  if (lines.length === 0) return [];
  // The inner right edge of the cell, where the source program had to wrap.
  const innerRight = cell.x + cell.width - padding;
  const room = cell.width - padding * 2;
  const paragraphs: { lines: Line[]; text: string }[] = [];
  let previous: Line | null = null;
  for (const line of lines) {
    const current = paragraphs.at(-1);
    const startsNew =
      !current ||
      !previous ||
      START_MARK.test(line.text) ||
      line.y - previous.y > previous.size * PARAGRAPH_PITCH ||
      line.bold !== previous.bold ||
      // A line that ends before the cell was full ends its paragraph.
      wouldFit(previous, line, room, wrap);
    if (startsNew) paragraphs.push({ lines: [line], text: line.text });
    else if (current && previous) {
      current.text += joinWrapped(previous, line, wrap, innerRight - (previous.x + previous.width));
      current.lines.push(line);
    }
    previous = line;
  }
  return paragraphs.map((p) => {
    const first = p.lines[0];
    const size = p.lines.reduce((best, line) => (line.text.length > best.text.length ? line : best)).size;
    return {
      kind: "text",
      y: first.y - first.size,
      text: p.text,
      size,
      bold: first.bold,
      align: alignOf(p.lines, cell),
      edges: { first, last: p.lines.at(-1)! },
      pitch: pitchOf(p.lines),
    };
  });
}

function vAlignOf(items: CellItem[], lines: Line[], cell: { y: number; height: number }): VAlign {
  if (lines.length === 0 || items.some((item) => item.kind === "table")) return "top";
  const top = Math.min(...lines.map((line) => line.y - line.size)) - cell.y;
  const bottom = cell.y + cell.height - Math.max(...lines.map((line) => line.y + line.size * 0.25));
  if (Math.abs(top - bottom) <= Math.max(2.5, cell.height * 0.15)) return "center";
  return bottom < top * 0.5 ? "bottom" : "top";
}

/**
 * Finds ruled tables on a page and puts each piece of text into its cell.
 * Returns the tables (nested ones inside their cells) and the text that lies outside every table.
 */
export function findTables(
  runs: TextRun[],
  segments: Segment[],
  fills: Fill[],
  wrap: Wrap = "words",
): { tables: TableBlock[]; rest: TextRun[] } {
  const { horizontals, verticals } = splitLines(segments);
  const grids: (Grid & { box: { x: number; y: number; width: number; height: number } })[] = [];
  for (const part of components(horizontals, verticals)) {
    if (part.horizontals.length < 2 || part.verticals.length < 1) continue;
    const grid = buildGrid(part.horizontals, part.verticals);
    if (!grid) continue;
    const { xs, ys } = grid;
    grids.push({ ...grid, box: { x: xs[0], y: ys[0], width: xs.at(-1)! - xs[0], height: ys.at(-1)! - ys[0] } });
  }
  // Smallest first, so text and nesting go to the innermost table.
  grids.sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height);

  const cellRuns = grids.map((grid) => grid.cells.map(() => [] as TextRun[]));
  const rest: TextRun[] = [];
  for (const run of runs) {
    if (!run.text.trim()) continue;
    const [x, y] = center(run);
    let placed = false;
    for (const [g, grid] of grids.entries()) {
      if (!inside(x, y, grid.box)) continue;
      const index = grid.cells.findIndex((cell) => inside(x, y, cell));
      if (index >= 0) {
        cellRuns[g][index].push(run);
        placed = true;
        break;
      }
    }
    if (!placed) rest.push(run);
  }

  const blocks: (TableBlock & { parent?: { grid: number; cell: number } })[] = grids.map((grid, g) => {
    const cellLines = grid.cells.map((_, c) => groupLines(cellRuns[g][c]));
    const padding = paddingOf(grid.cells, cellLines);
    return {
    ...grid.box,
    padding,
    wrap,
    columns: grid.xs.slice(1).map((x, i) => x - grid.xs[i]),
    rows: grid.ys.slice(1).map((y, i) => y - grid.ys[i]),
    cells: grid.cells.map((cell, c) => {
      const lines = cellLines[c];
      const items: CellItem[] = cellParagraphs(lines, cell, wrap, padding);
      const shade = fills.find(
        (fill) =>
          inside(cell.x + cell.width / 2, cell.y + cell.height / 2, fill) &&
          Math.min(fill.width, cell.width) * Math.min(fill.height, cell.height) >= cell.width * cell.height * SHADE_COVER,
      )?.color;
      return { ...cell, items, vAlign: vAlignOf(items, lines, cell), ...(shade ? { shade } : {}) };
    }),
    };
  });

  // Drop single boxes that frame a large part of the page; they are borders, not tables.
  const keep = blocks.map((block, g) => !(block.cells.length === 1 && groupLines(cellRuns[g][0]).length > MAX_BOX_LINES));
  for (const g of blocks.keys()) {
    if (keep[g]) continue;
    rest.push(...cellRuns[g][0]);
  }

  // Put each table inside the smallest larger table's cell that contains it.
  for (const [g, block] of blocks.entries()) {
    if (!keep[g]) continue;
    for (let p = g + 1; p < blocks.length; p++) {
      if (!keep[p]) continue;
      const cell = blocks[p].cells.findIndex(
        (c) => inside(block.x, block.y, c) && inside(block.x + block.width, block.y + block.height, c),
      );
      if (cell >= 0) {
        block.parent = { grid: p, cell };
        const target = blocks[p].cells[cell];
        target.items.push({ kind: "table", y: block.y, table: block });
        target.items.sort((a, b) => a.y - b.y);
        target.vAlign = "top";
        break;
      }
    }
  }

  const tables = blocks.filter((block, g) => keep[g] && !block.parent).sort((a, b) => a.y - b.y || a.x - b.x);
  return { tables, rest: rest.sort((a, b) => a.y - b.y || a.x - b.x) };
}

const rowText = (table: TableBlock, row: number) =>
  table.cells
    .filter((cell) => cell.row === row)
    .map((cell) => cell.items.map((item) => (item.kind === "text" ? item.text : "")).join(" "))
    .join("|")
    .replace(/\s+/g, "");

/**
 * Joins a table that continues from the previous page, when its columns match.
 * Rows the PDF repeated at the top of the new page become the table's repeated header.
 */
export function continueTable(previous: TableBlock, next: TableBlock): TableBlock | null {
  if (previous.columns.length !== next.columns.length) return null;
  if (previous.columns.some((width, i) => Math.abs(width - next.columns[i]) > TOLERANCE)) return null;

  let header = 0;
  while (
    header < next.rows.length - 1 &&
    header < previous.rows.length &&
    next.cells.filter((cell) => cell.row === header).every((cell) => cell.rowSpan === 1) &&
    rowText(next, header) === rowText(previous, header) &&
    rowText(next, header) !== ""
  ) {
    header++;
  }

  const lastRow = previous.rows.length - 1;
  const split = rowContinues(previous, lastRow, next, header);
  const skip = split ? header + 1 : header;
  const previousCells = split
    ? previous.cells.map((cell) => {
        if (cell.row !== lastRow) return cell;
        const piece = next.cells.find((other) => other.row === header && other.col === cell.col);
        return piece ? joinCells(cell, piece, previous) : cell;
      })
    : previous.cells;
  const rows = [...previous.rows];
  if (split) rows[lastRow] += next.rows[header];

  const offset = previous.rows.length - skip;
  return {
    ...previous,
    height: previous.height + next.height,
    rows: [...rows, ...next.rows.slice(skip)],
    headerRows: Math.max(previous.headerRows ?? 0, header),
    joinedRows: [...(previous.joinedRows ?? []), ...(split ? [lastRow] : [])],
    cells: [
      ...previousCells,
      ...next.cells.filter((cell) => cell.row >= skip).map((cell) => ({ ...cell, row: cell.row + offset })),
    ],
  };
}

const RUNNING_TEXT = 10;
const SENTENCE_END = /([.。!?:;)\]」』"'”’]|다|함|음|임|됨|것|요)$/;

const rowCells = (table: TableBlock, row: number) => table.cells.filter((cell) => cell.row === row);
const firstText = (cell: Cell) => cell.items.find((item) => item.kind === "text")?.text ?? "";
const lastText = (cell: Cell) => cell.items.findLast((item) => item.kind === "text")?.text ?? "";

/**
 * Whether the first row of the new page is the rest of a row the page break cut in two:
 * the rows have the same cells, no cell ends a sentence or starts a new item, and running text stops mid-sentence.
 */
function rowContinues(previous: TableBlock, lastRow: number, next: TableBlock, row: number): boolean {
  const before = rowCells(previous, lastRow);
  const after = rowCells(next, row);
  if (row >= next.rows.length || before.length !== after.length) return false;
  if (before.some((cell, i) => cell.col !== after[i].col || cell.colSpan !== after[i].colSpan || cell.rowSpan !== 1)) return false;
  if (after.some((cell) => cell.rowSpan !== 1)) return false;
  const pairs = before.map((cell, i) => ({ end: lastText(cell).trim(), start: firstText(after[i]).trim() }));
  // Any finished sentence or new item means the old row ended at the page break.
  if (pairs.some(({ end, start }) => SENTENCE_END.test(end) || START_MARK.test(start))) return false;
  // Short labels never look finished, so the evidence must come from running text cut mid-sentence.
  return pairs.some(({ end, start }) => end.length >= RUNNING_TEXT && start !== "");
}

/** Puts the two pieces of a cut cell back together, joining the sentence that the page break split. */
function joinCells(top: Cell, bottom: Cell, table: TableBlock): Cell {
  const items = [...top.items];
  const rest = [...bottom.items];
  const last = items.at(-1);
  const first = rest[0];
  // A line that ended before the cell was full, such as a two-line label, was broken on purpose, not by the page.
  const cut = (above: CellParagraph, below: CellParagraph) =>
    !above.edges || !below.edges || !wouldFit(above.edges.last, below.edges.first, top.width - table.padding * 2, table.wrap);
  if (last?.kind === "text" && first?.kind === "text" && !START_MARK.test(first.text) && cut(last, first)) {
    // The same rule as a line break inside the cell decides whether the page break dropped a space.
    const above = last.edges?.last;
    const below = first.edges?.first;
    const joined =
      above && below
        ? // Spans are numbered per page, so they say nothing across the page break.
          joinWrapped(above, { ...below, text: first.text, runs: below.runs.map((run) => ({ ...run, span: undefined })) }, table.wrap, top.x + top.width - table.padding - (above.x + above.width))
        : `${/[A-Za-z0-9,]$/.test(last.text) ? " " : ""}${first.text}`;
    items[items.length - 1] = { ...last, text: last.text + joined, align: last.align === "center" && first.align !== "center" ? first.align : last.align };
    rest.shift();
  }
  return { ...top, height: top.height + bottom.height, items: [...items, ...rest], vAlign: top.vAlign };
}
