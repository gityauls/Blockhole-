/** A horizontal or vertical line on the page, in points from the top left. */
export type Segment = { x1: number; y1: number; x2: number; y2: number };

/** A filled rectangle, such as a shaded table cell. */
export type Fill = { x: number; y: number; width: number; height: number; color: string };

export type Shapes = { lines: Segment[]; fills: Fill[] };

type Matrix = [number, number, number, number, number, number];

/** The pdf.js operator codes this reader needs, looked up by name. */
export type OpCodes = Record<string, number>;

// Path commands inside pdf.js constructPath data.
const MOVE = 0;
const LINE = 1;
const CURVE = 2;
const QUAD = 3;
const CLOSE = 4;

const STRAIGHT = 0.5;
const THIN = 2.5;
const MIN_LENGTH = 2;
const WHITE = /^#?f{6}$/i;

const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[2] * m2[1],
  m1[1] * m2[0] + m1[3] * m2[1],
  m1[0] * m2[2] + m1[2] * m2[3],
  m1[1] * m2[2] + m1[3] * m2[3],
  m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
  m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
];

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

type Point = [number, number];
type Subpath = { points: Point[]; closed: boolean; curved: boolean };

function subpaths(data: ArrayLike<number>, toPage: (x: number, y: number) => Point): Subpath[] {
  const result: Subpath[] = [];
  let current: Subpath | null = null;
  for (let i = 0; i < data.length; ) {
    const command = data[i++];
    if (command === MOVE) {
      current = { points: [toPage(data[i], data[i + 1])], closed: false, curved: false };
      result.push(current);
      i += 2;
    } else if (command === LINE) {
      current?.points.push(toPage(data[i], data[i + 1]));
      i += 2;
    } else if (command === CURVE || command === QUAD) {
      const size = command === CURVE ? 6 : 4;
      if (current) {
        current.curved = true;
        current.points.push(toPage(data[i + size - 2], data[i + size - 1]));
      }
      i += size;
    } else if (command === CLOSE) {
      if (current) current.closed = true;
    } else {
      break;
    }
  }
  return result;
}

function straightEdges(path: Subpath): Segment[] {
  const { points } = path;
  const ends = path.closed ? points.length : points.length - 1;
  const edges: Segment[] = [];
  for (let i = 0; i < ends; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const flat = Math.abs(y2 - y1) <= STRAIGHT;
    const upright = Math.abs(x2 - x1) <= STRAIGHT;
    if ((flat || upright) && Math.hypot(x2 - x1, y2 - y1) >= MIN_LENGTH) edges.push({ x1, y1, x2, y2 });
  }
  return edges;
}

/** The axis-aligned rectangle a closed path draws, if it is one. */
function rectangle(path: Subpath) {
  if (path.curved) return null;
  const points = path.points.slice();
  const [fx, fy] = points[0];
  const [lx, ly] = points[points.length - 1];
  if (points.length === 5 && Math.abs(fx - lx) < STRAIGHT && Math.abs(fy - ly) < STRAIGHT) points.pop();
  if (points.length !== 4) return null;
  const square = points.every(([x1, y1], i) => {
    const [x2, y2] = points[(i + 1) % 4];
    return Math.abs(x2 - x1) <= STRAIGHT || Math.abs(y2 - y1) <= STRAIGHT;
  });
  if (!square) return null;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * Collects the straight lines and filled boxes a page draws, in page coordinates.
 * Tables are drawn either as stroked lines or as thin filled rectangles, depending on the program.
 */
export function readShapes(
  fnArray: ArrayLike<number>,
  argsArray: ArrayLike<unknown>,
  ops: OpCodes,
  viewport: Matrix,
): Shapes {
  const lines: Segment[] = [];
  const fills: Fill[] = [];
  const stack: { ctm: Matrix; fill: string; stroke: string }[] = [];
  let state = { ctm: [1, 0, 0, 1, 0, 0] as Matrix, fill: "#000000", stroke: "#000000" };

  const strokes = new Set([ops.stroke, ops.closeStroke, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);
  const fillsWith = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke, ops.closeFillStroke, ops.closeEOFillStroke]);

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];
    if (fn === ops.save) stack.push({ ...state });
    else if (fn === ops.restore) state = stack.pop() ?? state;
    else if (fn === ops.transform) state = { ...state, ctm: multiply(state.ctm, args as Matrix) };
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push({ ...state });
      const matrix = args[0] as Matrix | null;
      if (matrix) state = { ...state, ctm: multiply(state.ctm, matrix) };
    } else if (fn === ops.paintFormXObjectEnd) state = stack.pop() ?? state;
    else if (fn === ops.setFillRGBColor && typeof args[0] === "string") state = { ...state, fill: args[0] };
    else if (fn === ops.setStrokeRGBColor && typeof args[0] === "string") state = { ...state, stroke: args[0] };
    else if (fn === ops.constructPath) {
      const [paint, data] = args as [number, ArrayLike<number>[]];
      const strokeIt = strokes.has(paint) && !WHITE.test(state.stroke);
      const fillIt = fillsWith.has(paint) && !WHITE.test(state.fill);
      if (!strokeIt && !fillIt) continue;
      const ctm = multiply(viewport, state.ctm);
      const paths = (data ?? []).flatMap((part) => subpaths(part, (x, y) => apply(ctm, x, y)));

      for (const path of paths) {
        if (strokeIt && !path.curved) lines.push(...straightEdges(path));
        if (!fillIt) continue;
        const box = rectangle(path);
        if (!box) continue;
        const { x, y, width, height } = box;
        if (height <= THIN && width > height) lines.push({ x1: x, y1: y + height / 2, x2: x + width, y2: y + height / 2 });
        else if (width <= THIN && height > width) lines.push({ x1: x + width / 2, y1: y, x2: x + width / 2, y2: y + height });
        else fills.push({ ...box, color: state.fill.replace("#", "").toLowerCase() });
      }
    }
  }
  return { lines, fills };
}
