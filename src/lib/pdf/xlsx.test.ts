import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildXlsx, columnName } from "./xlsx";

const open = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return (name: string) => strFromU8(files[name]);
};

describe("columnName", () => {
  it("counts like spreadsheet columns", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(701)).toBe("ZZ");
    expect(columnName(702)).toBe("AAA");
  });
});

describe("buildXlsx", () => {
  const sheet = (rows: (string | number | null)[][]) => [{ name: "1쪽", rows }];

  it("includes every part a spreadsheet needs", () => {
    const read = open(buildXlsx(sheet([["a"]])));
    expect(read("[Content_Types].xml")).toContain("/xl/worksheets/sheet1.xml");
    expect(read("_rels/.rels")).toContain("xl/workbook.xml");
    expect(read("xl/_rels/workbook.xml.rels")).toContain("worksheets/sheet1.xml");
    expect(read("xl/workbook.xml")).toContain('name="1쪽"');
  });

  it("writes numbers as values and text inline, skipping empty cells", () => {
    const xml = open(buildXlsx(sheet([["품목", null, 1200]])))("xl/worksheets/sheet1.xml");
    expect(xml).toContain('<c r="A1" t="inlineStr"><is><t xml:space="preserve">품목</t></is></c>');
    expect(xml).toContain('<c r="C1"><v>1200</v></c>');
    expect(xml).not.toContain('r="B1"');
  });

  it("escapes markup and removes characters XML forbids", () => {
    const xml = open(buildXlsx(sheet([['A&B <"c">\u0001\u000b끝']])))("xl/worksheets/sheet1.xml");
    expect(xml).toContain("A&amp;B &lt;&quot;c&quot;&gt;끝");
  });

  it("sizes columns to the longest text", () => {
    const xml = open(buildXlsx(sheet([["짧음", "x"], ["아주 아주 긴 글자입니다", "y"]])))(
      "xl/worksheets/sheet1.xml",
    );
    expect(xml).toMatch(/<col min="1" max="1" width="\d+(\.\d+)?" customWidth="1"\/>/);
  });

  it("escapes sheet names", () => {
    expect(open(buildXlsx([{ name: "A&B", rows: [["x"]] }]))("xl/workbook.xml")).toContain(
      'name="A&amp;B"',
    );
  });
});
