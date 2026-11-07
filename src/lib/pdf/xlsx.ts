import { strToU8, zipSync } from "fflate";

export type SheetCell = string | number | null;
export type Sheet = { name: string; rows: SheetCell[][] };

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAX_CELL_LENGTH = 32767;

export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function escapeXml(text: string): string {
  return (
    text
      // PDF text can carry control characters, which make the whole file invalid XML.
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  );
}

function cellXml(cell: SheetCell, reference: string): string {
  if (cell === null || cell === "") return "";
  if (typeof cell === "number") return `<c r="${reference}"><v>${cell}</v></c>`;
  const text = escapeXml(cell.slice(0, MAX_CELL_LENGTH));
  return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function columnsXml(rows: SheetCell[][]): string {
  const count = Math.max(...rows.map((row) => row.length));
  let columns = "";
  for (let index = 0; index < count; index++) {
    const longest = Math.max(...rows.map((row) => String(row[index] ?? "").length));
    const width = Math.min(60, Math.max(8, longest * 1.6));
    columns += `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }
  return `<cols>${columns}</cols>`;
}

function sheetXml(rows: SheetCell[][]): string {
  const rowsXml = rows
    .map((row, rowIndex) => {
      const number = rowIndex + 1;
      const cells = row.map((cell, index) => cellXml(cell, `${columnName(index)}${number}`));
      return `<row r="${number}">${cells.join("")}</row>`;
    })
    .join("");
  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}">${columnsXml(rows)}<sheetData>${rowsXml}</sheetData></worksheet>`;
}

/** Writes a minimal .xlsx: we only ever produce sheets, so no spreadsheet library is needed. */
export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const sheetParts = sheets.map((_, index) => `/xl/worksheets/sheet${index + 1}.xml`);

  const contentTypes =
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheetParts
      .map(
        (part) =>
          `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    "</Types>";

  const rootRels =
    `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">` +
    `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
    "</Relationships>";

  const workbook =
    `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><sheets>` +
    sheets
      .map(
        (sheet, index) =>
          `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("") +
    "</sheets></workbook>";

  const workbookRels =
    `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_NS}">` +
    sheets
      .map(
        (_, index) =>
          `<Relationship Id="rId${index + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
      )
      .join("") +
    "</Relationships>";

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rootRels),
    "xl/workbook.xml": strToU8(workbook),
    "xl/_rels/workbook.xml.rels": strToU8(workbookRels),
  };
  sheets.forEach((sheet, index) => {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(sheetXml(sheet.rows));
  });

  return zipSync(files);
}
