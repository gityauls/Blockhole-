// Runs the app's own PDF -> Office code in Node, so fidelity samples are tested without a browser.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/convert.mjs <in.pdf> <out.docx|xlsx> [firstPage-lastPage]
import fs from "node:fs";
import { PDFDocument } from "pdf-lib";
import { readPages } from "../../src/lib/pdf/render.ts";
import { toDocx, toXlsx } from "../../src/lib/pdf/to-office.ts";

const [input, output, range] = process.argv.slice(2);
let bytes = new Uint8Array(fs.readFileSync(input));

if (range) {
  const [first, last = first] = range.split("-").map(Number);
  const source = await PDFDocument.load(bytes);
  const part = await PDFDocument.create();
  const indexes = Array.from({ length: last - first + 1 }, (_, i) => first - 1 + i);
  for (const page of await part.copyPages(source, indexes)) part.addPage(page);
  bytes = await part.save();
}

const use = output.endsWith(".xlsx") ? "xlsx" : "docx";
const started = Date.now();
const pages = await readPages(bytes, use);
const blob = await (use === "xlsx" ? toXlsx(pages) : toDocx(pages));
fs.writeFileSync(output, new Uint8Array(await blob.arrayBuffer()));
console.log(`${output}: ${pages.length} pages, ${((Date.now() - started) / 1000).toFixed(1)}s`);
