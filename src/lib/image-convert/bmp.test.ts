import { describe, expect, it } from "vitest";
import { encodeBmp } from "./bmp";

const header = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset);

describe("encodeBmp", () => {
  it("writes a valid 24-bit header with padded rows", () => {
    // 3 pixels wide: 9 bytes per row, padded to 12
    const out = encodeBmp(new Uint8ClampedArray(3 * 2 * 4).fill(255), 3, 2);
    const v = header(out);
    expect(String.fromCharCode(out[0], out[1])).toBe("BM");
    expect(v.getUint32(2, true)).toBe(54 + 12 * 2);
    expect(out.length).toBe(54 + 12 * 2);
    expect(v.getUint32(10, true)).toBe(54);
    expect(v.getInt32(18, true)).toBe(3);
    expect(v.getInt32(22, true)).toBe(2);
    expect(v.getUint16(28, true)).toBe(24);
  });

  it("stores rows bottom-up in BGR order", () => {
    const rgba = new Uint8ClampedArray([
      255, 0, 0, 255, // top: red
      0, 0, 255, 255, // bottom: blue
    ]);
    const out = encodeBmp(rgba, 1, 2);
    expect([...out.slice(54, 57)]).toEqual([255, 0, 0]); // bottom row: blue as BGR
    expect([...out.slice(58, 61)]).toEqual([0, 0, 255]); // top row: red as BGR
  });

  it("flattens transparency onto white", () => {
    const out = encodeBmp(new Uint8ClampedArray([0, 0, 0, 0]), 1, 1);
    expect([...out.slice(54, 57)]).toEqual([255, 255, 255]);
  });

  it("rejects a pixel buffer of the wrong size", () => {
    expect(() => encodeBmp(new Uint8ClampedArray(3), 1, 1)).toThrow();
  });
});
