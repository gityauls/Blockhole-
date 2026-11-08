// Summarizes a PDF page's structure tags and painted (non-clip) shapes. Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/pdf-inspect.mjs <file.pdf> [page]
import fs from "node:fs";
const pdfjs = await import("pdfjs-dist");
const [file, pageNo = 1] = process.argv.slice(2);
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
console.log("markInfo", JSON.stringify(await doc.getMarkInfo()));
const page = await doc.getPage(Number(pageNo));
const tree = await page.getStructTree();
const roles = {};
const walk = (n) => { if (n.role) roles[n.role] = (roles[n.role] || 0) + 1; (n.children || []).forEach(walk); };
if (tree) walk(tree);
console.log("struct roles", JSON.stringify(roles));
const ops = await page.getOperatorList();
const names = Object.fromEntries(Object.entries(pdfjs.OPS).map(([k, v]) => [v, k]));
const paints = {};
const sizes = { thinH: 0, thinV: 0, box: 0 };
for (let i = 0; i < ops.fnArray.length; i++) {
  if (names[ops.fnArray[i]] !== "constructPath") continue;
  const [op, , mm] = ops.argsArray[i];
  paints[names[op]] = (paints[names[op]] || 0) + 1;
  if (/fill|stroke/i.test(names[op]) && mm) {
    const w = mm[2] - mm[0], h = mm[3] - mm[1];
    if (h < 2 && w > 2) sizes.thinH++; else if (w < 2 && h > 2) sizes.thinV++; else sizes.box++;
  }
}
console.log("paint ops", JSON.stringify(paints), "shapes", JSON.stringify(sizes));
