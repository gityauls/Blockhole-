import { type PageContent, findGutter } from "./layout";
import { findTables } from "./tables";

/**
 * Undoes two-up printing ("모아찍기"), where two pages of the document were shrunk side by side onto one sheet.
 * A Word document should hold the original pages, so each sheet is cut in half and each half enlarged back.
 *
 * Found in the textbook PDF: an A4 landscape sheet holding two A4 portrait pages at 1/√2, so text set in 11pt
 * shows as 7.78pt. Its source .hwp file confirms the A4 portrait pages and the sizes.
 */

// Share of text pages that must show a gutter at the middle for the whole document to count as two-up.
const SPREAD_SHARE = 0.6;
const MIDDLE_TOLERANCE = 0.06;
const SIZE_TOLERANCE = 0.03;
// Standard paper sizes in points, portrait. A half of one of these, scaled up by √2, is the next size up.
const PAPER = [
  { width: 595.28, height: 841.89 }, // A4
  { width: 515.91, height: 728.5 }, // B5 (JIS)
  { width: 612, height: 792 }, // Letter
];

const near = (a: number, b: number) => Math.abs(a - b) <= b * SIZE_TOLERANCE;

/** How much to enlarge a half sheet: √2 when the half is a standard page, either way up, at 1/√2; otherwise 1. */
function scaleFor(half: { width: number; height: number }): number {
  const [short, long] = [Math.min(half.width, half.height), Math.max(half.width, half.height)];
  return PAPER.some((paper) => near(short * Math.SQRT2, paper.width) && near(long * Math.SQRT2, paper.height))
    ? Math.SQRT2
    : 1;
}

// A portrait sheet holds two landscape pages one above the other, with a clear band across its middle.
const BAND = 8;

function hasMiddleBand(page: PageContent): boolean {
  if (page.width >= page.height) return false;
  const middle = page.height / 2;
  const tables = page.shapes ? findTables(page.runs, page.shapes.lines, page.shapes.fills, page.wrap, page).tables : [];
  const spans = [
    ...page.runs.filter((run) => run.text.trim()).map((run) => [run.y - run.size, run.y]),
    ...tables.map((table) => [table.y, table.y + table.height]),
  ];
  const clear = spans.every(([top, bottom]) => bottom < middle - BAND || top > middle + BAND);
  const above = spans.some(([, bottom]) => bottom < middle);
  const below = spans.some(([top]) => top > middle);
  return clear && above && below;
}

function hasMiddleGutter(page: PageContent): boolean {
  if (page.width <= page.height) return false;
  const tables = page.shapes ? findTables(page.runs, page.shapes.lines, page.shapes.fills, page.wrap, page).tables : [];
  const gutter = findGutter(
    page.runs.filter((run) => !tables.some((t) => run.x >= t.x && run.x <= t.x + t.width && run.y >= t.y && run.y <= t.y + t.height)),
    page.width,
    tables,
  );
  return gutter !== null && Math.abs(gutter - page.width / 2) <= page.width * MIDDLE_TOLERANCE;
}

/** Whether the document was printed two-up: most text pages are wide and split down the exact middle. */
export function isTwoUp(pages: PageContent[]): boolean {
  const text = pages.filter((page) => page.runs.some((run) => run.text.trim()));
  if (text.length === 0) return false;
  return text.filter((page) => hasMiddleGutter(page) || hasMiddleBand(page)).length >= text.length * SPREAD_SHARE;
}

/**
 * One half of a sheet as a page of its own, moved to start at zero and enlarged by `scale`. A wide sheet is cut
 * into left and right halves, a tall one into top and bottom.
 */
function half(page: PageContent, side: 0 | 1, scale: number): PageContent {
  const wide = page.width > page.height;
  const middle = (wide ? page.width : page.height) / 2;
  const shift = side * middle;
  const inside = (along: number) => (side === 0 ? along < middle : along >= middle);
  const fx = (x: number) => (wide ? x - shift : x) * scale;
  const fy = (y: number) => (wide ? y : y - shift) * scale;
  // Which coordinate decides the side: x for a wide sheet, y for a tall one.
  const pick = (x: number, y: number) => (wide ? x : y);
  return {
    width: (wide ? middle : page.width) * scale,
    height: (wide ? page.height : middle) * scale,
    runs: page.runs
      .filter((run) => inside(pick(run.x + run.width / 2, run.y - run.size / 2)))
      .map((run) => ({ ...run, x: fx(run.x), y: fy(run.y), width: run.width * scale, size: run.size * scale })),
    colors: [],
    wrap: page.wrap,
    shapes: page.shapes && {
      lines: page.shapes.lines
        .filter((line) => inside(pick((line.x1 + line.x2) / 2, (line.y1 + line.y2) / 2)))
        .map((line) => ({ x1: fx(line.x1), y1: fy(line.y1), x2: fx(line.x2), y2: fy(line.y2) })),
      fills: page.shapes.fills
        .filter((fill) => inside(pick(fill.x + fill.width / 2, fill.y + fill.height / 2)))
        .map((fill) => ({ ...fill, x: fx(fill.x), y: fy(fill.y), width: fill.width * scale, height: fill.height * scale })),
    },
  };
}

/** The document's pages as they were before two-up printing, or the pages unchanged if it was not printed so. */
export function unimpose(pages: PageContent[]): PageContent[] {
  if (!isTwoUp(pages)) return pages;
  return pages.flatMap((page) => {
    // A sheet without text, such as a scanned one, stays whole: cutting its image is not worth the risk.
    if (!page.runs.some((run) => run.text.trim())) return [page];
    const wide = page.width > page.height;
    if (!wide && !hasMiddleBand(page)) return [page];
    const scale = scaleFor(wide ? { width: page.width / 2, height: page.height } : { width: page.width, height: page.height / 2 });
    return [half(page, 0, scale), half(page, 1, scale)];
  });
}
