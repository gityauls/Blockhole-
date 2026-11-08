// Puts two page images side by side (original left, ours right) for a visual check.
// Usage: node scripts/fidelity/pair.mjs <left.png> <right.png> <out.png>
import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const [left, right, out] = process.argv.slice(2);
const [a, b] = await Promise.all([loadImage(left), loadImage(right)]);
const canvas = createCanvas(a.width + b.width + 20, Math.max(a.height, b.height));
const context = canvas.getContext("2d");
context.fillStyle = "#888";
context.fillRect(0, 0, canvas.width, canvas.height);
context.drawImage(a, 0, 0);
context.drawImage(b, a.width + 20, 0);
fs.writeFileSync(out, canvas.toBuffer("image/png"));
