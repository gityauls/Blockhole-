import { deflateSync } from "fflate";
import { describe, expect, it } from "vitest";
import { readCfb } from "./cfb";
import { readHwp } from "./records";

const SECTOR = 512;
const END = 0xfffffffe;
const FREE = 0xffffffff;

/**
 * Builds a version 3 compound file whose streams are all stored in regular sectors. Streams under 4096 bytes belong
 * in the mini stream, so each is padded to at least that; the HWP reader ignores bytes past its records.
 */
function compoundFile(streams: { name: string; storage?: string; data: Uint8Array }[]): Uint8Array {
  const padded = streams.map((s) => {
    const size = Math.max(4096, Math.ceil(s.data.length / SECTOR) * SECTOR);
    const data = new Uint8Array(size);
    data.set(s.data);
    return { ...s, data, size };
  });
  const storages = [...new Set(padded.flatMap((s) => (s.storage ? [s.storage] : [])))];
  // Entries: root, storages, then streams. Siblings are chained through "right".
  type Node = { name: string; type: number; child: number; right: number; start: number; size: number };
  const nodes: Node[] = [{ name: "Root Entry", type: 5, child: FREE, right: FREE, start: END, size: 0 }];
  for (const name of storages) nodes.push({ name, type: 1, child: FREE, right: FREE, start: 0, size: 0 });
  // Sector 0 holds the FAT, then come the directory's sectors (four entries each), then the streams.
  const directorySectors = Math.ceil((1 + storages.length + padded.length) / 4);
  let sector = 1 + directorySectors;
  for (const s of padded) {
    nodes.push({ name: s.name, type: 2, child: FREE, right: FREE, start: sector, size: s.size });
    sector += s.data.length / SECTOR;
  }
  const link = (parent: number, children: number[]) => {
    children.forEach((child, i) => {
      if (i === 0) nodes[parent].child = child;
      else nodes[children[i - 1]].right = child;
    });
  };
  const streamIndex = (i: number) => 1 + storages.length + i;
  link(0, [
    ...storages.map((_, i) => 1 + i),
    ...padded.flatMap((s, i) => (s.storage ? [] : [streamIndex(i)])),
  ]);
  storages.forEach((name, i) => link(1 + i, padded.flatMap((s, j) => (s.storage === name ? [streamIndex(j)] : []))));

  const total = sector;
  const out = new Uint8Array(SECTOR * (total + 1));
  const view = new DataView(out.buffer);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, 1, true);
  view.setUint32(0x38, 4096, true);
  view.setUint32(0x3c, END, true);
  view.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, i === 0 ? 0 : FREE, true);
  // FAT: sector 0 is the FAT itself, 1 the directory, then each stream's chain.
  const fat = new Array(SECTOR / 4).fill(FREE);
  fat[0] = 0xfffffffd;
  for (let k = 1; k <= directorySectors; k++) fat[k] = k === directorySectors ? END : k + 1;
  for (const node of nodes.filter((n) => n.type === 2)) {
    const count = Math.max(4096, Math.ceil(node.size / SECTOR) * SECTOR) / SECTOR;
    for (let k = 0; k < count; k++) fat[node.start + k] = k === count - 1 ? END : node.start + k + 1;
  }
  fat.forEach((value, i) => view.setUint32(SECTOR + i * 4, value, true));
  nodes.forEach((node, i) => {
    const base = 2 * SECTOR + i * 128;
    [...node.name].forEach((char, k) => view.setUint16(base + k * 2, char.charCodeAt(0), true));
    view.setUint16(base + 64, (node.name.length + 1) * 2, true);
    out[base + 66] = node.type;
    view.setUint32(base + 68, FREE, true);
    view.setUint32(base + 72, node.right, true);
    view.setUint32(base + 76, node.child, true);
    view.setUint32(base + 116, node.start, true);
    view.setUint32(base + 120, node.size, true);
  });
  padded.forEach((s, i) => out.set(s.data, SECTOR * (nodes[streamIndex(i)].start + 1)));
  return out;
}

/** One HWP record: a 4-byte header (tag, level, size) and its data. */
function record(tag: number, level: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + data.length);
  new DataView(out.buffer).setUint32(0, tag | (level << 10) | (data.length << 20), true);
  out.set(data, 4);
  return out;
}
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};
const bytes = (size: number, fill: (view: DataView) => void) => {
  const data = new Uint8Array(size);
  fill(new DataView(data.buffer));
  return data;
};
const utf16 = (text: string) => bytes(text.length * 2, (v) => [...text].forEach((c, i) => v.setUint16(i * 2, c.charCodeAt(0), true)));

describe("readCfb", () => {
  it("lists streams by path and reads them back", () => {
    const file = readCfb(compoundFile([{ name: "FileHeader", data: utf16("HWP") }, { name: "Section0", storage: "BodyText", data: utf16("본문") }]));
    expect(file.paths.sort()).toEqual(["BodyText/Section0", "FileHeader"]);
    expect(file.read("BodyText/Section0")?.subarray(0, 4)).toEqual(utf16("본문"));
  });
});

describe("readHwp", () => {
  it("reads character shapes, paragraph shapes, text and laid-out lines", () => {
    const header = bytes(256, (v) => {
      [..."HWP Document File"].forEach((c, i) => v.setUint8(i, c.charCodeAt(0)));
      v.setUint32(36, 1, true); // compressed
    });
    const charShape = bytes(72, (v) => {
      v.setUint8(14, 97); // Hangul width 97%
      v.setInt8(21, -3); // Hangul spacing -3%
      v.setInt32(42, 1100, true); // 11pt
    });
    const paraShape = bytes(54, (v) => {
      v.setUint32(46, 0, true); // percent
      v.setUint32(50, 170, true);
    });
    const info = concat([record(21, 0, charShape), record(25, 0, paraShape)]);
    const lineSegs = bytes(72, (v) => {
      v.setInt32(4, 0, true);
      v.setInt32(8, 1100, true);
      v.setInt32(36 + 4, 1872, true); // next line 18.72pt lower
    });
    const body = concat([
      record(66, 0, bytes(22, (v) => v.setUint16(8, 0, true))),
      record(67, 1, utf16("수확량 감소\r")),
      record(68, 1, bytes(8, () => {})),
      record(69, 1, lineSegs),
    ]);
    const doc = readHwp(
      compoundFile([
        { name: "FileHeader", data: header },
        { name: "DocInfo", data: deflateSync(info) },
        { name: "Section0", storage: "BodyText", data: deflateSync(body) },
      ]),
    );
    expect(doc.charShapes[0]).toMatchObject({ ratio: 97, spacing: -3, size: 11 });
    expect(doc.paraShapes[0]).toMatchObject({ lineKind: "percent", lineSpacing: 170 });
    const [paragraph] = doc.sections[0].paragraphs;
    expect(paragraph.text).toBe("수확량 감소");
    expect(paragraph.lines[1].top - paragraph.lines[0].top).toBeCloseTo(18.72);
  });
});
