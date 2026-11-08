// Compares the structure of converted .docx files with the original Word file (the answer key).
// Usage: node scripts/fidelity/docx-compare.mjs <origDir> <name> <label=dir> [label=dir...]
import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";

/** Reads tables (with nesting, spans and vertical merges) and body paragraphs from word/document.xml. */
export function readDocx(file) {
  const xml = strFromU8(unzipSync(new Uint8Array(fs.readFileSync(file)))["word/document.xml"]);
  const tokens = xml.matchAll(/<(\/?)w:(tbl|tr|tc|p|t|gridSpan|vMerge|gridCol|drawing)\b([^>]*?)(\/?)>([^<]*)/g);
  const tables = [];
  const stack = []; // open tables
  const paragraphs = [];
  let text = "";
  let inText = false;
  let paragraph = "";
  let images = 0;

  for (let [, close, tag, attrs, selfClose, after] of tokens) {
    const table = stack.at(-1);
    if (tag === "tbl") {
      if (!close) {
        const t = { depth: stack.length, rows: [], grid: 0, spans: 0, vmerges: 0 };
        tables.push(t);
        stack.push(t);
      } else stack.pop();
    } else if (tag === "gridCol" && table && !close) table.grid++;
    else if (tag === "tr" && table && !close) table.rows.push([]);
    else if (tag === "tc" && table && !close) table.rows.at(-1).push("");
    else if (tag === "gridSpan" && table && !/w:val="1"/.test(attrs)) table.spans++;
    else if (tag === "vMerge" && table && !/w:val="restart"/.test(attrs)) table.vmerges++;
    else if (tag === "drawing" && !close) images++;
    else if (tag === "t") {
      inText = !close && !selfClose;
      if (inText) {
        after = after.replace(/&(lt|gt|amp|quot|apos);/g, (_, e) => ({ lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" })[e]);
        text += after;
        paragraph += after;
        if (table) {
          const row = table.rows.at(-1);
          row[row.length - 1] += after;
        }
      }
    } else if (tag === "p" && close) {
      if (!stack.length && paragraph.trim()) paragraphs.push(paragraph);
      if (table) {
        const row = table.rows.at(-1);
        if (row?.length) row[row.length - 1] += " ";
      }
      paragraph = "";
      text += "\n";
    }
  }
  return { tables, paragraphs, text, images };
}

const squash = (s) => s.replace(/\s+/g, "");

/** Share of the original's characters that appear in the same order in the copy (LCS / original length). */
export function orderedMatch(original, copy) {
  const a = squash(original);
  const b = squash(copy);
  if (!a.length) return 1;
  let previous = new Uint16Array(b.length + 1);
  let current = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      current[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], current[j - 1]);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] / a.length;
}

/** Share of original cells whose text equals a cell in the same row and column of the matching table. */
function cellMatch(origTables, copyTables) {
  let total = 0;
  let same = 0;
  origTables.forEach((t, index) => {
    const other = copyTables[index];
    t.rows.forEach((row, r) =>
      row.forEach((cell, c) => {
        total++;
        if (other && squash(other.rows[r]?.[c] ?? "\u0000") === squash(cell)) same++;
      }),
    );
  });
  return total ? same / total : 1;
}

function describe(doc) {
  const top = doc.tables.filter((t) => t.depth === 0);
  return {
    tables: `${top.length}${doc.tables.length > top.length ? ` (+${doc.tables.length - top.length} nested)` : ""}`,
    shapes: doc.tables.map((t) => `${t.rows.length}x${t.grid}`).join(" ") || "-",
    cells: doc.tables.reduce((n, t) => n + t.rows.flat().length, 0),
    merges: doc.tables.reduce((n, t) => n + t.spans + t.vmerges, 0),
    paragraphs: doc.paragraphs.length,
    images: doc.images,
  };
}

if (import.meta.url === `file:///${process.argv[1].replaceAll("\\", "/")}`) {
  const [origDir, name, ...copies] = process.argv.slice(2);
  const original = readDocx(path.join(origDir, `${name}.docx`));
  const origTableText = original.tables.filter((t) => t.depth === 0).map((t) => t.rows.flat().join(" ")).join("\n");
  const rows = [["", ...Object.keys(describe(original)), "text order", "table text order", "cells exact"]];
  rows.push(["original", ...Object.values(describe(original)), "100%", "100%", "100%"]);
  for (const entry of copies) {
    const [label, dir] = entry.split("=");
    const file = path.join(dir, `${name}.docx`);
    if (!fs.existsSync(file)) {
      rows.push([label, "missing"]);
      continue;
    }
    const copy = readDocx(file);
    const pct = (x) => `${Math.round(x * 100)}%`;
    rows.push([
      label,
      ...Object.values(describe(copy)),
      pct(orderedMatch(original.text, copy.text)),
      pct(orderedMatch(origTableText, copy.text)),
      pct(cellMatch(original.tables, copy.tables)),
    ]);
  }
  console.log(`## ${name}`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
