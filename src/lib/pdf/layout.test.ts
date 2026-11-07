import { describe, expect, it } from "vitest";
import {
  type TextRun,
  cellValue,
  groupLines,
  groupParagraphs,
  splitColumns,
  tableRows,
  textBoxes,
} from "./layout";

const run = (text: string, x: number, y: number, width = text.length * 6, size = 12, bold = false): TextRun => ({
  text,
  x,
  y,
  width,
  size,
  bold,
});

describe("groupLines", () => {
  it("orders top to bottom, then left to right", () => {
    const lines = groupLines([run("둘째", 10, 40), run("뒤", 40, 20), run("앞", 10, 20)]);
    expect(lines.map((line) => line.text)).toEqual(["앞 뒤", "둘째"]);
  });

  it("keeps slightly uneven baselines on one line", () => {
    expect(groupLines([run("a", 10, 20), run("b", 30, 21.5)])).toHaveLength(1);
  });

  it("joins touching runs without a space", () => {
    const lines = groupLines([run("농업", 10, 20, 24), run("재해", 34, 20, 24)]);
    expect(lines[0].text).toBe("농업재해");
  });

  it("ignores blank runs", () => {
    expect(groupLines([run("   ", 10, 20), run("a", 30, 20)])[0].text).toBe("a");
  });

  it("measures the whole line", () => {
    const [line] = groupLines([run("a", 10, 20, 10), run("b", 50, 20, 10)]);
    expect(line.x).toBe(10);
    expect(line.width).toBe(50);
  });
});

describe("groupParagraphs", () => {
  const paragraphs = (runs: TextRun[]) => groupParagraphs(groupLines(runs));

  it("joins wrapped lines", () => {
    expect(paragraphs([run("첫 줄", 10, 20), run("둘째 줄", 10, 36)]).map((p) => p.text)).toEqual([
      "첫 줄 둘째 줄",
    ]);
  });

  it("splits on a large gap", () => {
    expect(paragraphs([run("위", 10, 20), run("아래", 10, 60)])).toHaveLength(2);
  });

  it("splits a heading from body text by size and keeps its style", () => {
    const result = paragraphs([run("제목", 10, 20, 48, 24, true), run("본문", 10, 44)]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ text: "제목", size: 24, bold: true });
  });
});

describe("tableRows", () => {
  it("lines cells up in columns, leaving gaps empty", () => {
    const rows = tableRows(
      groupLines([
        run("품목", 10, 20),
        run("면적", 100, 20),
        run("금액", 200, 20),
        run("사과", 10, 40),
        run("1,200", 201, 40),
      ]),
    );
    expect(rows).toEqual([
      ["품목", "면적", "금액"],
      ["사과", "", "1,200"],
    ]);
  });

  it("keeps nearby runs in one cell", () => {
    expect(tableRows(groupLines([run("농업", 10, 20, 24), run("재해", 38, 20, 24)]))).toEqual([
      ["농업 재해"],
    ]);
  });
});

describe("splitColumns", () => {
  const body = (x: number, label: string) =>
    Array.from({ length: 12 }, (_, line) => run(`${label}${line}`, x, 40 + line * 20, 280));

  it("separates two columns with a clear gutter", () => {
    const columns = splitColumns([...body(420, "오른쪽"), ...body(40, "왼쪽")], 760);
    expect(columns).toHaveLength(2);
    expect(columns[0].every((r) => r.text.startsWith("왼쪽"))).toBe(true);
    expect(columns[1].every((r) => r.text.startsWith("오른쪽"))).toBe(true);
  });

  it("leaves a single column alone", () => {
    expect(splitColumns(body(40, "본문").map((r) => ({ ...r, width: 680 })), 760)).toHaveLength(1);
  });

  it("is not fooled by short lines that leave the middle empty", () => {
    expect(splitColumns(body(40, "짧은 줄"), 760)).toHaveLength(1);
  });

  it("tolerates one heading across the gutter", () => {
    const heading = run("표제", 200, 20, 400);
    const left = Array.from({ length: 30 }, (_, i) => run(`왼${i}`, 40, 40 + i * 14, 280));
    const right = Array.from({ length: 30 }, (_, i) => run(`오${i}`, 420, 40 + i * 14, 280));
    expect(splitColumns([heading, ...left, ...right], 760)).toHaveLength(2);
  });

  it("reads a side-by-side page in column order", () => {
    const columns = splitColumns([...body(40, "왼쪽"), ...body(420, "오른쪽")], 760);
    const lines = columns.flatMap((column) => groupLines(column));
    expect(lines[0].text).toBe("왼쪽0");
    expect(lines[12].text).toBe("오른쪽0");
  });
});

describe("textBoxes", () => {
  it("splits a line at a wide gap so each part keeps its position", () => {
    const boxes = textBoxes([run("왼쪽 글", 40, 20, 100), run("오른쪽 글", 420, 20, 100)]);
    expect(boxes.map((box) => [box.text, box.x])).toEqual([
      ["왼쪽 글", 40],
      ["오른쪽 글", 420],
    ]);
  });

  it("keeps ordinary word spacing in one box", () => {
    const boxes = textBoxes([run("농업", 40, 20, 24), run("재해", 68, 20, 24)]);
    expect(boxes).toHaveLength(1);
  });
});

describe("cellValue", () => {
  it("turns numbers into numbers", () => {
    expect(cellValue("1,200")).toBe(1200);
    expect(cellValue("-3.5")).toBe(-3.5);
  });
  it("leaves codes and text alone", () => {
    expect(cellValue("007")).toBe("007");
    expect(cellValue("2023년")).toBe("2023년");
    expect(cellValue("1,2,3")).toBe("1,2,3");
  });
});
