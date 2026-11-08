// Measures the advance width of characters in Malgun Gothic as Word sets them, without reading the font file:
//   1. node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/malgun-widths.mjs make <dir>
//      writes widths.docx, one paragraph per character, each character repeated REPEAT times at 10pt
//   2. powershell -File scripts/fidelity/word-look.ps1 <dir>      (Word exports widths.pdf)
//   3. node --import ./scripts/fidelity/hooks.mjs scripts/fidelity/malgun-widths.mjs read <dir>
//      prints the widths in font sizes, for the table in src/lib/pdf/to-office.ts
import fs from "node:fs";
import path from "node:path";

const REPEAT = 20;
const SIZE = 10;
const ascii = Array.from({ length: 0x7f - 0x21 }, (_, i) => String.fromCharCode(0x21 + i));
const symbols = [..."·•※→←↑↓↔⇒∼～㎜㎡㎝㎞㎏ℓ①②③④⑤⑥⑦⑧⑨⑩○●□■△▲▽◇◆☞✓×÷±≤≥≠∙‘’“”「」『』〈〉《》…–—‐²³°℃Ⅰ Ⅱ Ⅲ Ⅳ"].filter((c) => c !== " ");
const chars = [...ascii, ...symbols];

const [mode, dir] = process.argv.slice(2);
if (mode === "make") {
  // Made by the converter itself, so Word lays the text out with the same Korean defaults as real output
  // (balanceSingleByteDoubleByteWidth and the rest change the width of half-width characters).
  const { toDocx } = await import("../../src/lib/pdf/to-office.ts");
  // The space is measured between Hangul, as "가 가 가"; everything else on its own.
  const lines = [...chars.map((c) => c.repeat(REPEAT)), `${"가 ".repeat(REPEAT)}`.trim()];
  const perPage = 30;
  const pages = [];
  for (let i = 0; i < lines.length; i += perPage) {
    pages.push({
      width: 595.28,
      height: 841.89,
      colors: [],
      wrap: "anywhere",
      runs: lines.slice(i, i + perPage).map((text, k) => ({ text, x: 72, y: 80 + k * 24, width: 1, size: SIZE, bold: false })),
    });
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "widths.docx"), new Uint8Array(await (await toDocx(pages)).arrayBuffer()));
  console.log(`wrote ${lines.length} lines`);
} else {
  const { readPages } = await import("../../src/lib/pdf/render.ts");
  const { groupLines } = await import("../../src/lib/pdf/layout.ts");
  const pages = await readPages(new Uint8Array(fs.readFileSync(path.join(dir, "widths.pdf"))));
  const lines = pages.flatMap((page) => groupLines(page.runs));
  const widths = {};
  for (const line of lines) {
    const text = line.text.replace(/\s/g, "");
    if (text.startsWith("가가")) {
      // "가 " repeated: twenty Hangul (one size each) and nineteen spaces between them.
      widths[" "] = +((line.width / SIZE - REPEAT) / (REPEAT - 1)).toFixed(3);
      continue;
    }
    const char = text[0];
    if (text.length === REPEAT && [...text].every((c) => c === char)) widths[char] = +(line.width / SIZE / REPEAT).toFixed(3);
  }
  console.log(JSON.stringify(widths));
}
