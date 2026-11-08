// Prints a .docx as text: body paragraphs, and table rows as cells separated by " | ".
import { readDocx } from "./docx-compare.mjs";
const doc = readDocx(process.argv[2]);
console.log(doc.text.split("\n").filter((l) => l.trim()).map((l, i) => `${String(i + 1).padStart(2)}: ${l}`).join("\n"));
