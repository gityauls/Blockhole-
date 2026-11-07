import { type Zippable, zipSync } from "fflate";
import { encodeBmp } from "./bmp";
import type { OutputFormat } from "./formats";

const MIME_TYPES: Record<Exclude<OutputFormat, "bmp">, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const QUALITY = 0.92;

async function decode(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file);
  } catch {
    throw new Error("이미지를 읽을 수 없습니다. 파일이 손상되지 않았는지 확인하세요.");
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));
}

/** Runs entirely in the browser: the file never leaves the device. */
export async function convertImage(file: File, format: OutputFormat): Promise<Blob> {
  const bitmap = await decode(file);
  const { width, height } = bitmap;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("이미지가 너무 커서 변환할 수 없습니다.");

  // JPG has no alpha channel, so transparent pixels would turn black.
  if (format === "jpg") {
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  if (format === "bmp") {
    const { data } = context.getImageData(0, 0, width, height);
    return new Blob([encodeBmp(data, width, height)], { type: "image/bmp" });
  }

  const type = MIME_TYPES[format];
  const blob = await toBlob(canvas, type);
  if (!blob) throw new Error("이미지가 너무 커서 변환할 수 없습니다.");
  // Browsers silently fall back to PNG for encoders they lack.
  if (blob.type !== type) {
    throw new Error(
      `이 브라우저는 ${format.toUpperCase()} 저장을 지원하지 않습니다. 다른 형식을 고르세요.`,
    );
  }
  return blob;
}

export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function zipBlobs(files: { name: string; blob: Blob }[]): Promise<Blob> {
  const entries: Zippable = {};
  for (const { name, blob } of files) {
    // Images are already compressed, so store them as-is.
    entries[name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  return new Blob([new Uint8Array(zipSync(entries))], { type: "application/zip" });
}
