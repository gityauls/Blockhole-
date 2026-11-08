import { type PageContent, groupLines } from "./layout";

/**
 * Finds the page number printed at the foot of each page, so it can become a page number field in the footer
 * instead of body text. Body text that sits at the bottom of the page is pushed to the next column or page by the
 * smallest difference in height, and a number that counts pages belongs in the footer anyway, as in the source:
 * the textbook's .hwp file numbers its pages with one automatic page number control.
 */

const NUMBER = /^([-–—(]?\s*)(\d{1,4})(\s*[-–—)]?)$/;
// The number must be the lowest text, in the bottom share of the page.
const FOOT = 0.85;
// Most text pages must carry a number that counts up by one for the document to use a footer.
const NUMBERED_SHARE = 0.6;

export type PageNumbers = {
  /** The number of the first page. */
  start: number;
  /** Text around the number, such as "- " and " -". */
  prefix: string;
  suffix: string;
  align: "left" | "center" | "right";
  size: number;
  /** Distance from the bottom of the page to the number's baseline, in points. */
  baselineFromBottom: number;
};

type Found = { page: number; number: number; prefix: string; suffix: string; x: number; width: number; y: number; size: number };

function footNumber(page: PageContent, index: number): Found | null {
  const lines = groupLines(page.runs);
  const last = lines.at(-1);
  if (!last || last.y < page.height * FOOT) return null;
  const match = NUMBER.exec(last.text.trim());
  if (!match) return null;
  return { page: index, number: Number(match[2]), prefix: match[1], suffix: match[3], x: last.x, width: last.width, y: last.y, size: last.size };
}

/** Removes page numbers from the pages and describes them for a footer, or leaves the pages as they are. */
export function takePageNumbers(pages: PageContent[]): { pages: PageContent[]; numbers: PageNumbers | null } {
  const found = pages.map(footNumber);
  const text = pages.filter((page) => page.runs.some((run) => run.text.trim())).length;
  const hits = found.filter((f): f is Found => f !== null);
  // Numbers count pages when number minus page index stays the same.
  const offsets = new Map<number, number>();
  for (const f of hits) offsets.set(f.number - f.page, (offsets.get(f.number - f.page) ?? 0) + 1);
  const [offset, count] = [...offsets].sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
  if (text === 0 || offset < 0 || count < text * NUMBERED_SHARE) return { pages, numbers: null };

  const counted = hits.filter((f) => f.number - f.page === offset);
  const sample = counted[0];
  const middle = sample.x + sample.width / 2;
  const width = pages[sample.page].width;
  const align = Math.abs(middle - width / 2) < width * 0.05 ? "center" : middle > width / 2 ? "right" : "left";
  const keep = new Set(counted.map((f) => f.page));
  return {
    pages: pages.map((page, index) => {
      if (!keep.has(index)) return page;
      const f = found[index]!;
      return { ...page, runs: page.runs.filter((run) => Math.abs(run.y - f.y) > Math.max(1, f.size * 0.5)) };
    }),
    numbers: {
      start: offset,
      prefix: sample.prefix,
      suffix: sample.suffix,
      align,
      size: sample.size,
      baselineFromBottom: pages[sample.page].height - sample.y,
    },
  };
}
