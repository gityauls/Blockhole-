import { describe, expect, it } from "vitest";
import type { TextRun } from "./layout";
import type { Segment } from "./shapes";
import { type CellParagraph, type TableBlock, continueTable, findTables } from "./tables";

const run = (text: string, x: number, y: number, width = text.length * 8, size = 10): TextRun => ({
  text,
  x,
  y,
  width,
  size,
  bold: false,
});
const h = (y: number, x1: number, x2: number): Segment => ({ x1, y1: y, x2, y2: y });
const v = (x: number, y1: number, y2: number): Segment => ({ x1: x, y1, x2: x, y2 });

/** Full grid lines for the given column and row edges. */
function grid(xs: number[], ys: number[]): Segment[] {
  return [...ys.map((y) => h(y, xs[0], xs.at(-1)!)), ...xs.map((x) => v(x, ys[0], ys.at(-1)!))];
}

const texts = (table: TableBlock) =>
  table.cells.map((cell) => cell.items.map((item) => (item.kind === "text" ? item.text : "[table]")).join("/"));

describe("findTables", () => {
  it("builds a grid and puts each piece of text in its cell", () => {
    const { tables, rest } = findTables(
      [run("품목", 20, 32), run("금액", 120, 32), run("사과", 20, 52), run("1,200", 120, 52), run("본문", 20, 100)],
      grid([10, 110, 210], [20, 40, 60]),
      [],
    );
    expect(tables).toHaveLength(1);
    expect(tables[0].columns).toEqual([100, 100]);
    expect(texts(tables[0])).toEqual(["품목", "금액", "사과", "1,200"]);
    expect(rest.map((r) => r.text)).toEqual(["본문"]);
  });

  it("finds merged cells where a dividing line is missing", () => {
    // Column 0 has no line between rows 1 and 2, so its two cells are one.
    const lines = [
      h(20, 10, 210), h(40, 10, 210), h(60, 110, 210), h(80, 10, 210),
      v(10, 20, 80), v(110, 20, 80), v(210, 20, 80),
    ];
    const { tables } = findTables([run("복분자", 20, 64), run("1일", 120, 52), run("8일", 120, 72)], lines, []);
    const merged = tables[0].cells.find((cell) => cell.row === 1 && cell.col === 0);
    expect(merged).toMatchObject({ rowSpan: 2, colSpan: 1 });
    expect(tables[0].cells).toHaveLength(5);
  });

  it("joins a cell's wrapped lines into one paragraph", () => {
    const { tables } = findTables(
      [run("보상하는 손해를", 20, 32, 88), run("말한다", 20, 44, 40)],
      grid([10, 110], [20, 50]),
      [],
      "words",
    );
    expect(texts(tables[0])).toEqual(["보상하는 손해를 말한다"]);
  });

  it("does not add a space at a break inside a word when the source breaks anywhere", () => {
    const { tables } = findTables([run("보통약", 20, 32, 30), run("관", 20, 44, 10)], grid([10, 54], [20, 50]), [], "anywhere");
    expect(texts(tables[0])).toEqual(["보통약관"]);
  });

  it("starts a new paragraph at a bullet", () => {
    const { tables } = findTables(
      [run("• 첫째 항목", 20, 32, 88), run("• 둘째 항목", 20, 44, 88)],
      grid([10, 110], [20, 50]),
      [],
    );
    expect(tables[0].cells[0].items).toHaveLength(2);
  });

  it("detects centered text and shading", () => {
    const { tables } = findTables(
      [run("구분", 50, 32, 20)],
      grid([10, 110], [20, 40]),
      [{ x: 10, y: 20, width: 100, height: 20, color: "d9d9d9" }],
    );
    const [cell] = tables[0].cells;
    expect((cell.items[0] as CellParagraph).align).toBe("center");
    expect(cell.shade).toBe("d9d9d9");
  });

  it("nests a table drawn inside another table's cell", () => {
    const outer = grid([10, 60, 300], [20, 40, 200]);
    const inner = grid([70, 120, 290], [80, 100, 120]);
    const { tables } = findTables(
      [run("구분", 20, 32), run("위 글", 70, 60), run("태풍", 75, 92), run("정의", 125, 92), run("아래 글", 70, 150)],
      [...outer, ...inner],
      [],
    );
    expect(tables).toHaveLength(1);
    const cell = tables[0].cells.find((c) => c.row === 1 && c.col === 1)!;
    expect(cell.items.map((item) => item.kind)).toEqual(["text", "table", "text"]);
  });

  it("keeps lines of tables that share an x position apart", () => {
    // Two tables, one above the other, both with a line at x = 110.
    const { tables } = findTables([], [...grid([10, 110, 210], [20, 40]), ...grid([10, 60, 110, 210], [300, 320])], []);
    expect(tables.map((t) => t.columns.length)).toEqual([2, 3]);
  });

  it("does not treat lines without a crossing line as a table", () => {
    expect(findTables([run("밑줄", 20, 30)], [h(32, 20, 60)], []).tables).toHaveLength(0);
  });

  it("leaves a frame around most of the page as plain text", () => {
    const body = Array.from({ length: 20 }, (_, i) => run(`줄${i}`, 20, 40 + i * 14));
    const { tables, rest } = findTables(body, grid([10, 500], [20, 340]), []);
    expect(tables).toHaveLength(0);
    expect(rest).toHaveLength(20);
  });
});

describe("continueTable", () => {
  const page = (rows: [string, string][], y0 = 20) => {
    const ys = rows.map((_, i) => y0 + i * 20);
    ys.push(y0 + rows.length * 20);
    const runs = rows.flatMap(([a, b], i) => [run(a, 20, y0 + i * 20 + 14), run(b, 120, y0 + i * 20 + 14)]);
    return findTables(runs, grid([10, 110, 300], ys), []).tables[0];
  };

  it("joins matching columns and turns the repeated first row into a header", () => {
    const first = page([["구분", "기준"], ["방상팬", "기둥 높이 6m 이상."]]);
    const second = page([["구분", "기준"], ["방풍림", "나무 간격 5m 이하."]]);
    const joined = continueTable(first, second)!;
    expect(joined.rows).toHaveLength(3);
    expect(joined.headerRows).toBe(1);
    expect(texts(joined)).toEqual(["구분", "기준", "방상팬", "기둥 높이 6m 이상.", "방풍림", "나무 간격 5m 이하."]);
  });

  it("puts back together a row the page break cut in two", () => {
    const first = page([["구분", "기준"], ["트렐리스", "철선을 늘려 나무를 고"]]);
    const second = page([["구분", "기준"], ["2,4,6선식", "정해 주는 방식이다."]]);
    const joined = continueTable(first, second)!;
    expect(joined.rows).toHaveLength(2);
    expect(texts(joined).slice(2)).toEqual(["트렐리스2,4,6선식", "철선을 늘려 나무를 고정해 주는 방식이다."]);
  });

  it("refuses tables whose columns differ", () => {
    const narrow = findTables([], grid([10, 60, 300], [20, 40]), []).tables[0];
    expect(continueTable(page([["가", "나"]]), narrow)).toBeNull();
  });
});
