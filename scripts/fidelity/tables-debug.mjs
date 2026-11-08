// Prints the lines and tables the converter finds on one PDF page.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/tables-debug.mjs <file.pdf> [page] [--lines]
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { readPages } from "../../src/lib/pdf/render.ts";
import { findTables } from "../../src/lib/pdf/tables.ts";
const [file, pageNo = "1", flag] = process.argv.slice(2);
// Read only the requested page.
const source = await PDFDocument.load(fs.readFileSync(file));
const part = await PDFDocument.create();
const [copied] = await part.copyPages(source, [Number(pageNo) - 1]);
part.addPage(copied);
const [page] = await readPages(await part.save(), "docx");
const r = (n) => Math.round(n * 10) / 10;
if (flag === "--lines") for (const l of page.shapes.lines) console.log("line", r(l.x1), r(l.y1), r(l.x2), r(l.y2));
const { tables, rest } = findTables(page.runs, page.shapes.lines, page.shapes.fills);
for (const t of tables) {
  console.log(`table at ${r(t.x)},${r(t.y)} ${r(t.width)}x${r(t.height)} cols=${t.columns.map(r)} rows=${t.rows.map(r)}`);
  for (const c of t.cells) console.log(`  [${c.row},${c.col}] span ${c.rowSpan}x${c.colSpan} ${c.vAlign}${c.shade ? " shade " + c.shade : ""} | ${c.items.map((i) => (i.kind === "text" ? `${i.align}:${i.text}` : "[table]")).join(" / ")}`);
}
console.log("outside:", rest.length, "runs");
