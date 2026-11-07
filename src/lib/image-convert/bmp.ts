const HEADER_BYTES = 54;

/** Encodes RGBA pixels as a 24-bit BMP, flattening transparency onto white. */
export function encodeBmp(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array<ArrayBuffer> {
  if (rgba.length !== width * height * 4) {
    throw new Error("Pixel buffer does not match the image size");
  }

  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const out = new Uint8Array(HEADER_BYTES + rowBytes * height);
  const view = new DataView(out.buffer);

  out[0] = 0x42; // "B"
  out[1] = 0x4d; // "M"
  view.setUint32(2, out.length, true);
  view.setUint32(10, HEADER_BYTES, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, rowBytes * height, true);

  for (let y = 0; y < height; y++) {
    let target = HEADER_BYTES + (height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const alpha = rgba[source + 3] / 255;
      const over = (channel: number) => Math.round(channel * alpha + 255 * (1 - alpha));
      out[target++] = over(rgba[source + 2]);
      out[target++] = over(rgba[source + 1]);
      out[target++] = over(rgba[source]);
    }
  }

  return out;
}
