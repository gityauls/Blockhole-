// Compares a .docx converted from a PDF with the .hwp file the PDF was made from: the answer key.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/hwp-compare.mjs <answer.hwp> <ours.docx>
//
// Whole books are too long for a character-by-character comparison, so it measures:
// - tables: how many, and how many answer tables have a table of the same rows x columns in ours
// - cells: share of answer cells whose text is a cell in ours (as a multiset, ignoring spaces)
// - paragraphs: share of answer body paragraphs (10+ characters) that are a whole paragraph in ours
// - order: share of answer 20-character runs of text that appear in ours, which breaks when text is reordered
import fs from "node:fs";
import { readHwp } from "../../src/lib/hwp/records.ts";
import { readDocx } from "./docx-compare.mjs";

const [hwpFile, docxFile] = process.argv.slice(2);
const squash = (s) => s.replace(/\s+/g, "");
const RUN = 20;

const doc = readHwp(new Uint8Array(fs.readFileSync(hwpFile)));
const answer = { tables: [], nested: 0, cells: [], paragraphs: [], text: "" };
function visit(paragraphs, depth) {
  for (const p of paragraphs) {
    answer.text += `${p.text}\n`;
    if (depth === 0 && squash(p.text).length >= 10) answer.paragraphs.push(squash(p.text));
    for (const control of p.controls) {
      if (!control.table) continue;
      if (depth > 0) answer.nested++;
      else answer.tables.push(`${control.table.rows}x${control.table.cols}`);
      for (const cell of control.table.cells) {
        answer.cells.push(squash(cell.paragraphs.map((q) => q.text).join("")));
        visit(cell.paragraphs, depth + 1);
      }
    }
  }
}
for (const section of doc.sections) visit(section.paragraphs, 0);

const ours = readDocx(docxFile);
const ourTables = ours.tables.filter((t) => t.depth === 0).map((t) => `${t.rows.length}x${t.grid}`);
const ourCells = ours.tables.flatMap((t) => t.rows.flat().map(squash));

/** Share of `wanted` items found in `have`, each item of `have` used once. */
function multisetShare(wanted, have) {
  const pool = new Map();
  for (const item of have) pool.set(item, (pool.get(item) ?? 0) + 1);
  let found = 0;
  for (const item of wanted) {
    const left = pool.get(item) ?? 0;
    if (left > 0) {
      found++;
      pool.set(item, left - 1);
    }
  }
  return wanted.length ? found / wanted.length : 1;
}

const ourText = squash(ours.text);
const runs = new Set();
for (let i = 0; i + RUN <= ourText.length; i++) runs.add(ourText.slice(i, i + RUN));
const answerText = squash(answer.text);
let total = 0;
let present = 0;
for (let i = 0; i + RUN <= answerText.length; i += RUN) {
  total++;
  if (runs.has(answerText.slice(i, i + RUN))) present++;
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const hangul = (s) => (s.match(/[가-힣]/g) ?? []).length;
console.log("| | tables | nested | cells | Hangul |");
console.log("|---|---|---|---|---|");
console.log(`| answer (.hwp) | ${answer.tables.length} | ${answer.nested} | ${answer.cells.length} | ${hangul(answer.text)} |`);
console.log(`| ours (.docx) | ${ourTables.length} | ${ours.tables.length - ourTables.length} | ${ourCells.length} | ${hangul(ours.text)} |`);
console.log();
console.log(`table shapes found: ${pct(multisetShare(answer.tables, ourTables))}`);
console.log(`cell texts found:   ${pct(multisetShare(answer.cells.filter(Boolean), ourCells.filter(Boolean)))}`);
console.log(`paragraphs found:   ${pct(multisetShare(answer.paragraphs, ours.paragraphs.map(squash)))}`);
console.log(`text order (${RUN}-char runs): ${pct(present / total)}`);
