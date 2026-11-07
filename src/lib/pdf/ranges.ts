/** Turns text like "1-3, 5" into zero-based page indexes, or throws a message to show. */
export function parsePageRanges(text: string, pageCount: number): number[] {
  const pages = new Set<number>();
  const outOfRange = () => new Error(`페이지는 1부터 ${pageCount}까지 입력할 수 있습니다.`);

  for (const raw of text.split(",")) {
    const token = raw.trim();
    const match = token.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error(`"${token}"은 페이지 범위가 아닙니다. 1-3, 5처럼 입력하세요.`);

    const first = Number(match[1]);
    const last = Number(match[2] ?? match[1]);
    if (first > last) throw new Error(`"${token}"은 앞 번호가 더 큽니다. 작은 번호부터 입력하세요.`);
    if (first < 1 || last > pageCount) throw outOfRange();

    for (let page = first; page <= last; page++) pages.add(page - 1);
  }

  return [...pages];
}

/** Turns "1-3, 5" into "1-3_5" for use in a file name. */
export function pageRangeLabel(text: string): string {
  return text
    .split(",")
    .map((part) => part.replace(/\s+/g, ""))
    .join("_");
}
