// Renders PDF pages to PNG for side-by-side comparison.
// Usage: node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/render.mjs <in.pdf> <outDir> <page> [page...] [--scale=1.5]
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith("--scale="))?.slice(8) ?? 1.5);
const [input, outDir, ...pages] = args.filter((a) => !a.startsWith("--"));
fs.mkdirSync(outDir, { recursive: true });

const pdfjs = await import("pdfjs-dist");
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(input)) }).promise;
const base = path.basename(input, ".pdf").slice(0, 24);

for (const number of pages.length ? pages.map(Number) : Array.from({ length: doc.numPages }, (_, i) => i + 1)) {
  const page = await doc.getPage(number);
  const viewport = page.getViewport({ scale });
  const canvas = doc.canvasFactory.create(viewport.width, viewport.height);
  await page.render({ canvas: canvas.canvas, viewport }).promise;
  const file = path.join(outDir, `${base}-p${number}.png`);
  fs.writeFileSync(file, canvas.canvas.toBuffer("image/png"));
  console.log(file);
}

