// Summarizes an HWP file's layout facts: page setup, tables, and how often each width scale, letter spacing and
// line spacing is used, weighted by characters. The answer key for PDFs made from that file.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/hwp-summary.mjs <file.hwp>
import fs from "node:fs";
import { readHwp } from "../../src/lib/hwp/records.ts";

const doc = readHwp(new Uint8Array(fs.readFileSync(process.argv[2])));
const tally = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);
const ratio = new Map(), spacing = new Map(), line = new Map();
let tables = 0, nested = 0, cells = 0, hangul = 0, pageNumbers = 0;

function visit(paragraphs, depth) {
  for (const p of paragraphs) {
    const shape = doc.paraShapes[p.paraShape];
    hangul += (p.text.match(/[가-힣]/g) ?? []).length;
    p.charShapes.forEach((cs, i) => {
      const end = p.charShapes[i + 1]?.start ?? p.text.length;
      const n = Math.max(0, end - cs.start);
      const c = doc.charShapes[cs.id];
      tally(ratio, c.ratio, n);
      tally(spacing, c.spacing, n);
    });
    if (shape) tally(line, `${shape.lineKind} ${shape.lineSpacing}`, p.text.length);
    for (const control of p.controls) {
      if (control.id === "pgnp") pageNumbers++;
      if (!control.table) continue;
      if (depth > 0) nested++;
      else tables++;
      cells += control.table.cells.length;
      for (const cell of control.table.cells) visit(cell.paragraphs, depth + 1);
    }
  }
}
for (const section of doc.sections) visit(section.paragraphs, 0);

const top = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k}:${v}`).join("  ");
console.log("sections", doc.sections.length, "pages", JSON.stringify(doc.sections.map((s) => s.page)));
console.log({ tables, nested, cells, hangul, pageNumbers, charShapes: doc.charShapes.length, paraShapes: doc.paraShapes.length });
console.log("장평 %  ", top(ratio));
console.log("자간 %  ", top(spacing));
console.log("줄 간격 ", top(line));
