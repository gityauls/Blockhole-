import { describe, expect, it } from "vitest";
import { readShapes } from "./shapes";

// Operator codes as pdf.js numbers them; only the names matter to the reader.
const OPS = {
  save: 10,
  restore: 11,
  transform: 12,
  stroke: 20,
  closeStroke: 21,
  fill: 22,
  eoFill: 23,
  fillStroke: 24,
  eoFillStroke: 25,
  closeFillStroke: 26,
  closeEOFillStroke: 27,
  endPath: 28,
  setStrokeRGBColor: 58,
  setFillRGBColor: 59,
  paintFormXObjectBegin: 74,
  paintFormXObjectEnd: 75,
  constructPath: 91,
};
const IDENTITY: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
// Rectangle as pdf.js path data: moveTo, three lineTo, closePath.
const rect = (x: number, y: number, w: number, h: number) =>
  new Float32Array([0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 4]);

function read(ops: [number, unknown[]][], viewport = IDENTITY) {
  return readShapes(
    ops.map(([fn]) => fn),
    ops.map(([, args]) => args),
    OPS,
    viewport,
  );
}

describe("readShapes", () => {
  it("turns a stroked rectangle into four lines", () => {
    const { lines, fills } = read([[OPS.constructPath, [OPS.stroke, [rect(10, 20, 100, 50)], null]]]);
    expect(lines).toHaveLength(4);
    expect(fills).toHaveLength(0);
  });

  it("reads thin filled rectangles as lines, the way Word draws borders", () => {
    const { lines } = read([
      [OPS.constructPath, [OPS.eoFill, [rect(10, 20, 100, 0.5)], null]],
      [OPS.constructPath, [OPS.eoFill, [rect(10, 20, 0.5, 60)], null]],
    ]);
    expect(lines).toEqual([
      { x1: 10, y1: 20.25, x2: 110, y2: 20.25 },
      { x1: 10.25, y1: 20, x2: 10.25, y2: 80 },
    ]);
  });

  it("keeps larger filled rectangles as shaded boxes with their color", () => {
    const { fills } = read([
      [OPS.setFillRGBColor, ["#D9D9D9"]],
      [OPS.constructPath, [OPS.fill, [rect(10, 20, 100, 16)], null]],
    ]);
    expect(fills).toEqual([{ x: 10, y: 20, width: 100, height: 16, color: "d9d9d9" }]);
  });

  it("ignores white fills and clipping paths", () => {
    const { lines, fills } = read([
      [OPS.setFillRGBColor, ["#ffffff"]],
      [OPS.constructPath, [OPS.fill, [rect(0, 0, 500, 800)], null]],
      [OPS.constructPath, [OPS.endPath, [rect(0, 0, 500, 800)], null]],
    ]);
    expect(lines).toHaveLength(0);
    expect(fills).toHaveLength(0);
  });

  it("applies transforms and restores them", () => {
    const { lines } = read([
      [OPS.save, []],
      [OPS.transform, [1, 0, 0, 1, 100, 0]],
      [OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 10, 1, 50, 10])], null]],
      [OPS.restore, []],
      [OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 30, 1, 50, 30])], null]],
    ]);
    expect(lines.map((l) => l.x1)).toEqual([100, 0]);
  });

  it("maps to page coordinates with the viewport, flipping y", () => {
    const { lines } = read([[OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 790, 1, 50, 790])], null]]], [1, 0, 0, -1, 0, 800]);
    expect(lines[0]).toMatchObject({ y1: 10, y2: 10 });
  });

  it("skips curves and slanted lines", () => {
    const { lines } = read([
      [OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 0, 1, 50, 40])], null]],
      [OPS.constructPath, [OPS.stroke, [new Float32Array([0, 0, 0, 2, 10, 10, 20, 10, 30, 0])], null]],
    ]);
    expect(lines).toHaveLength(0);
  });
});
