import { describe, expect, it } from "vitest";
import {
  type TextRun,
  cellValue,
  findGutter,
  joinWrapped,
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

describe("findGutter", () => {
  it("never puts a gutter inside a table", () => {
    // A wide table with an empty strip down the middle, and one caption line.
    const runs = [run("표 제목", 300, 20, 120)];
    expect(findGutter(runs, 760, [{ x: 40, y: 40, width: 680, height: 400 }])).toBeNull();
  });

  it("still finds the gutter between two pages that hold tables", () => {
    const left = Array.from({ length: 6 }, (_, i) => run(`왼${i}`, 40, 40 + i * 20, 280));
    const right = Array.from({ length: 6 }, (_, i) => run(`오${i}`, 420, 40 + i * 20, 280));
    const gutter = findGutter([...left, ...right], 760, [{ x: 40, y: 200, width: 280, height: 100 }]);
    expect(gutter).toBeGreaterThan(320);
    expect(gutter).toBeLessThan(420);
  });
});

describe("joinWrapped", () => {
  const [first] = groupLines([run("내구성 및", 10, 20, 50)]);
  const [second] = groupLines([run("내재해성", 10, 34, 40)]);

  it("adds the space a word-wrapping program dropped at the line break", () => {
    expect(joinWrapped(first, second, "words", 0)).toBe(" 내재해성");
  });

  it("adds no space when the next character would not have fitted on the line", () => {
    expect(joinWrapped(first, second, "anywhere", 5)).toBe("내재해성");
  });

  it("adds a space when the next character would have fitted, so the line broke at a space", () => {
    expect(joinWrapped(first, second, "anywhere", 10)).toBe(" 내재해성");
  });

  it("trusts word spans over the room left: one span across the break is one word", () => {
    const tagged = (text: string, y: number, width: number, span: number) => groupLines([{ ...run(text, 10, y, width), span }])[0];
    // Both lines ended with 6pt left, less than a Hangul character, so the room cannot tell the two apart.
    expect(joinWrapped(tagged("비닐 및 망", 20, 50, 3), tagged("등을", 34, 20, 5), "anywhere", 6)).toBe(" 등을");
    expect(joinWrapped(tagged("과수", 20, 20, 7), tagged("원", 34, 10, 7), "anywhere", 6)).toBe("원");
    // Word starts a span where Hangul meets digits, so there the room decides.
    expect(joinWrapped(tagged("10", 20, 11, 8), tagged("월", 34, 10, 9), "anywhere", 2)).toBe("월");
  });

  it("joins a number cut inside because it was longer than the line", () => {
    const [ten] = groupLines([run("10", 10, 20, 11)]);
    const [zero] = groupLines([run("0", 10, 34, 5.5)]);
    expect(joinWrapped(ten, zero, "anywhere", 2)).toBe("0");
    const [words] = groupLines([run("length 10", 10, 20, 40)]);
    expect(joinWrapped(words, zero, "anywhere", 2)).toBe(" 0");
  });
});
