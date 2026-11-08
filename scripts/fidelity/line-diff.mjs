// Compares where each text line sits in the original PDF and in our .docx exported to PDF by Word.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/line-diff.mjs <original.pdf> <ours.pdf> [minDelta=1]
import fs from "node:fs";
import { readPages } from "../../src/lib/pdf/render.ts";
import { textBoxes } from "../../src/lib/pdf/layout.ts";
const [a, b, min = "1"] = process.argv.slice(2);
const read = async (file) =>
  (await readPages(new Uint8Array(fs.readFileSync(file)))).flatMap((page, p) =>
    textBoxes(page.runs).map((l) => ({ p: p + 1, y: l.y, x: l.x, text: l.text.replace(/\s+/g, "") })),
  ).sort((m, n) => m.p - n.p || m.y - n.y || m.x - n.x);
const orig = await read(a);
const ours = await read(b);
const used = new Set();
for (const o of orig) {
  const i = ours.findIndex((c, k) => !used.has(k) && c.text === o.text);
  if (i < 0) { console.log(`missing  p${o.p} y${o.y.toFixed(1)} ${o.text.slice(0, 30)}`); continue; }
  used.add(i);
  const c = ours[i];
  const dy = c.y - o.y, dx = c.x - o.x;
  if (c.p !== o.p || Math.abs(dy) >= +min || Math.abs(dx) >= +min)
    console.log(`p${o.p}${c.p !== o.p ? "->p" + c.p : ""} y${o.y.toFixed(1)} dy ${dy.toFixed(1).padStart(6)} dx ${dx.toFixed(1).padStart(6)}  ${o.text.slice(0, 30)}`);
}
