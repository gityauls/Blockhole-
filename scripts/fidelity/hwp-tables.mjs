// Pairs each table of the answer .hwp with the table of ours that holds the same text, and lists how they differ.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/hwp-tables.mjs <answer.hwp> <ours.docx> [limit]
import fs from "node:fs";
import { readHwp } from "../../src/lib/hwp/records.ts";
import { readDocx } from "./docx-compare.mjs";

const [hwpFile, docxFile, limit = "40"] = process.argv.slice(2);
const squash = (s) => s.replace(/\s+/g, "");
const answer = [];
const doc = readHwp(new Uint8Array(fs.readFileSync(hwpFile)));
const visit = (paragraphs) => {
  for (const p of paragraphs)
    for (const control of p.controls) {
      if (!control.table) continue;
      const t = control.table;
      const cells = t.cells.map((c) => squash(c.paragraphs.map((q) => q.text).join("")));
      answer.push({ shape: `${t.rows}x${t.cols}`, cells, text: cells.join(""), borderless: t.cells.length && null });
    }
};
for (const section of doc.sections) visit(section.paragraphs);

const ours = readDocx(docxFile).tables.filter((t) => t.depth === 0).map((t) => {
  const cells = t.rows.flat().map(squash);
  return { shape: `${t.rows.length}x${t.grid}`, cells, text: cells.join("") };
});

// Greedy in order: an answer table matches the table of ours just ahead that shares most of its two-letter pairs.
const pairs = (text) => new Set(Array.from({ length: Math.max(0, Math.min(text.length, 300) - 1) }, (_, i) => text.slice(i, i + 2)));
const score = (a, o) => { const want = pairs(a.text); if (!want.size) return 0; const have = pairs(o.text); let n = 0; for (const p of want) if (have.has(p)) n++; return n / want.size; };
let j = 0;
const rows = [];
const kinds = { same: 0, fewerCells: 0, moreCells: 0, otherShape: 0, notFound: 0 };
let lostCells = 0;
for (const [i, a] of answer.entries()) {
  if (a.text.length < 4) { kinds.notFound++; continue; }
  let k = -1;
  let best = 0.6;
  for (let m = j; m < Math.min(ours.length, j + 25); m++) { const v = score(a, ours[m]); if (v > best) { best = v; k = m; } }
  if (k < 0) { kinds.notFound++; lostCells += a.cells.length; rows.push(`#${i} ${a.shape} (${a.cells.length} cells) NOT FOUND  ${a.text.slice(0, 40)}`); continue; }
  j = k + 1;
  const o = ours[k];
  if (o.shape === a.shape && o.cells.length === a.cells.length) { kinds.same++; continue; }
  const kind = o.cells.length < a.cells.length ? "fewerCells" : o.cells.length > a.cells.length ? "moreCells" : "otherShape";
  kinds[kind]++;
  lostCells += Math.max(0, a.cells.length - o.cells.length);
  rows.push(`#${i} hwp ${a.shape} (${a.cells.length}) ours ${o.shape} (${o.cells.length}) ${kind}  ${a.text.slice(0, 40)}`);
}
console.log(kinds, "answer cells missing from matched/unmatched tables:", lostCells);
for (const row of rows.slice(0, +limit)) console.log(row);
