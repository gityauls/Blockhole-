/**
 * Reads streams from a Compound File Binary file (MS-CFB), the container HWP 5.0 documents use.
 * Only reading is supported, which is all a converter needs.
 */

const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const ENTRY_SIZE = 128;
const HEADER_DIFAT = 109;
const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

type Entry = { name: string; type: number; left: number; right: number; child: number; start: number; size: number };

export type Cfb = {
  /** Every stream by its full path, such as "BodyText/Section0". */
  paths: string[];
  read(path: string): Uint8Array | null;
};

export function readCfb(bytes: Uint8Array): Cfb {
  if (!SIGNATURE.every((byte, i) => bytes[i] === byte)) throw new Error("OLE 복합 파일이 아닙니다.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sectorSize = 1 << view.getUint16(0x1e, true);
  const miniSectorSize = 1 << view.getUint16(0x20, true);
  const firstDirectory = view.getUint32(0x30, true);
  const miniCutoff = view.getUint32(0x38, true);
  const firstMiniFat = view.getUint32(0x3c, true);
  let difatSector = view.getUint32(0x44, true);

  const sectorOffset = (sector: number) => (sector + 1) * sectorSize;

  // The FAT's own sectors are listed in the header, then in a chain of DIFAT sectors.
  const fatSectors: number[] = [];
  for (let i = 0; i < HEADER_DIFAT; i++) {
    const sector = view.getUint32(0x4c + i * 4, true);
    if (sector !== FREE) fatSectors.push(sector);
  }
  while (difatSector !== END_OF_CHAIN && difatSector !== FREE) {
    const base = sectorOffset(difatSector);
    const perSector = sectorSize / 4 - 1;
    for (let i = 0; i < perSector; i++) {
      const sector = view.getUint32(base + i * 4, true);
      if (sector !== FREE) fatSectors.push(sector);
    }
    difatSector = view.getUint32(base + perSector * 4, true);
  }
  const fat: number[] = [];
  for (const sector of fatSectors) {
    const base = sectorOffset(sector);
    for (let i = 0; i < sectorSize / 4; i++) fat.push(view.getUint32(base + i * 4, true));
  }

  const chain = (start: number, table: number[]) => {
    const sectors: number[] = [];
    for (let sector = start; sector !== END_OF_CHAIN && sector !== FREE && sectors.length <= table.length; ) {
      sectors.push(sector);
      sector = table[sector];
    }
    return sectors;
  };
  const readChain = (start: number) => {
    const sectors = chain(start, fat);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((sector, i) => out.set(bytes.subarray(sectorOffset(sector), sectorOffset(sector) + sectorSize), i * sectorSize));
    return out;
  };

  const directory = readChain(firstDirectory);
  const directoryView = new DataView(directory.buffer);
  const entries: Entry[] = [];
  for (let offset = 0; offset + ENTRY_SIZE <= directory.length; offset += ENTRY_SIZE) {
    const nameLength = directoryView.getUint16(offset + 64, true);
    let name = "";
    for (let i = 0; i + 2 < nameLength; i += 2) name += String.fromCharCode(directoryView.getUint16(offset + i, true));
    entries.push({
      name,
      type: directory[offset + 66],
      left: directoryView.getUint32(offset + 68, true),
      right: directoryView.getUint32(offset + 72, true),
      child: directoryView.getUint32(offset + 76, true),
      start: directoryView.getUint32(offset + 116, true),
      size: directoryView.getUint32(offset + 120, true),
    });
  }

  const miniFat: number[] = [];
  const miniFatBytes = firstMiniFat === END_OF_CHAIN ? new Uint8Array() : readChain(firstMiniFat);
  const miniFatView = new DataView(miniFatBytes.buffer);
  for (let i = 0; i + 4 <= miniFatBytes.length; i += 4) miniFat.push(miniFatView.getUint32(i, true));
  const miniStream = readChain(entries[0].start);

  // Storages hold their children as a red-black tree of siblings.
  const byPath = new Map<string, Entry>();
  const walk = (index: number, prefix: string) => {
    if (index === FREE || index >= entries.length) return;
    const entry = entries[index];
    walk(entry.left, prefix);
    walk(entry.right, prefix);
    const path = prefix + entry.name;
    if (entry.type === 2) byPath.set(path, entry);
    if (entry.type === 1) walk(entry.child, `${path}/`);
  };
  walk(entries[0].child, "");

  return {
    paths: [...byPath.keys()],
    read(path) {
      const entry = byPath.get(path);
      if (!entry) return null;
      if (entry.size >= miniCutoff) return readChain(entry.start).subarray(0, entry.size);
      const sectors = chain(entry.start, miniFat);
      const out = new Uint8Array(sectors.length * miniSectorSize);
      sectors.forEach((sector, i) =>
        out.set(miniStream.subarray(sector * miniSectorSize, (sector + 1) * miniSectorSize), i * miniSectorSize),
      );
      return out.subarray(0, entry.size);
    },
  };
}
