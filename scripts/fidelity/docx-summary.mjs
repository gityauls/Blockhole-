// Summarizes a .docx: tables, nested tables, cells, body paragraphs, Hangul characters, file size.
import fs from "node:fs";
import { readDocx } from "./docx-compare.mjs";
for (const file of process.argv.slice(2)) {
  const doc = readDocx(file);
  const top = doc.tables.filter((t) => t.depth === 0);
  console.log(file, {
    tables: top.length,
    nested: doc.tables.length - top.length,
    cells: doc.tables.reduce((n, t) => n + t.rows.flat().length, 0),
    paragraphs: doc.paragraphs.length,
    hangul: (doc.text.match(/[가-힣]/g) || []).length,
    mb: +(fs.statSync(file).size / 1048576).toFixed(2),
  });
}
