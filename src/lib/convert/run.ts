import { convertImage } from "@/lib/image-convert/convert";
import { type OutputFormat, outputName, uniqueNames } from "@/lib/image-convert/formats";
import { pageRangeLabel } from "@/lib/pdf/ranges";
import type { TargetId } from "./targets";

export type Output = { name: string; blob: Blob };
export type RunResult = { outputs: Output[]; failures: string[] };

type RunOptions = {
  ranges?: string;
  onProgress?: (message: string) => void;
};

const OFFICE_USE = { "pdf-docx": "docx", "pdf-xlsx": "xlsx", "pdf-pptx": "pptx" } as const;

const baseName = (name: string) => outputName(name, "").slice(0, -1);
const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());
const pdfBlob = (bytes: Uint8Array) =>
  new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : "처리하지 못했습니다.";

async function imagesToPdfOutput(files: File[]): Promise<Output> {
  const { imagesToPdf } = await import("@/lib/pdf/edit");
  const images = [];
  for (const file of files) {
    if (/\.(jpe?g)$/i.test(file.name) || /\.jpe$/i.test(file.name)) {
      images.push({ type: "jpg" as const, bytes: await bytesOf(file) });
    } else {
      const png = await convertImage(file, "png");
      images.push({ type: "png" as const, bytes: new Uint8Array(await png.arrayBuffer()) });
    }
  }
  const name = files.length === 1 ? `${baseName(files[0].name)}.pdf` : "images.pdf";
  return { name, blob: pdfBlob(await imagesToPdf(images)) };
}

async function mergeOutput(files: File[]): Promise<Output> {
  const { mergePdfs } = await import("@/lib/pdf/edit");
  const inputs = await Promise.all(
    files.map(async (file) => ({ name: file.name, bytes: await bytesOf(file) })),
  );
  return { name: "merged.pdf", blob: pdfBlob(await mergePdfs(inputs)) };
}

async function fileOutputs(
  file: File,
  target: TargetId,
  { ranges, onProgress }: RunOptions,
): Promise<Output[]> {
  const base = baseName(file.name);

  switch (target) {
    case "pdf-split": {
      const { extractPages, splitPdf } = await import("@/lib/pdf/edit");
      if (ranges?.trim()) {
        const blob = pdfBlob(await extractPages(await bytesOf(file), ranges));
        return [{ name: `${base}-${pageRangeLabel(ranges)}.pdf`, blob }];
      }
      const parts = await splitPdf(await bytesOf(file));
      return parts.map((part, index) => ({ name: `${base}-${index + 1}.pdf`, blob: pdfBlob(part) }));
    }
    case "pdf-jpg": {
      const { pdfToJpgs } = await import("@/lib/pdf/render");
      const images = await pdfToJpgs(await bytesOf(file), (page, total) =>
        onProgress?.(`${file.name} ${page}/${total}쪽`),
      );
      return images.map((blob, index) => ({ name: `${base}-${index + 1}.jpg`, blob }));
    }
    case "pdf-txt": {
      const { pdfToText } = await import("@/lib/pdf/render");
      const text = await pdfToText(await bytesOf(file));
      return [{ name: `${base}.txt`, blob: new Blob([text], { type: "text/plain;charset=utf-8" }) }];
    }
    case "pdf-docx":
    case "pdf-xlsx":
    case "pdf-pptx": {
      const { readPages } = await import("@/lib/pdf/render");
      const { toDocx, toPptx, toXlsx } = await import("@/lib/pdf/to-office");
      const use = OFFICE_USE[target];
      const pages = await readPages(await bytesOf(file), use, (page, total) =>
        onProgress?.(`${file.name} ${page}/${total}쪽`),
      );
      onProgress?.(`${file.name} 파일 만드는 중`);
      const build = { docx: toDocx, xlsx: toXlsx, pptx: toPptx }[use];
      return [{ name: `${base}.${use}`, blob: await build(pages) }];
    }
    default: {
      const format = target as OutputFormat;
      return [{ name: outputName(file.name, format), blob: await convertImage(file, format) }];
    }
  }
}

/** Runs entirely in the browser. One bad file never stops the others, except when combining. */
export async function runTarget(
  files: File[],
  target: TargetId,
  options: RunOptions = {},
): Promise<RunResult> {
  const outputs: Output[] = [];
  const failures: string[] = [];

  if (target === "pdf" || target === "pdf-merge") {
    try {
      outputs.push(await (target === "pdf" ? imagesToPdfOutput(files) : mergeOutput(files)));
    } catch (error) {
      failures.push(messageOf(error));
    }
    return { outputs, failures };
  }

  for (const file of files) {
    options.onProgress?.(file.name);
    try {
      outputs.push(...(await fileOutputs(file, target, options)));
    } catch (error) {
      failures.push(`${file.name}: ${messageOf(error)}`);
    }
  }

  const names = uniqueNames(outputs.map((output) => output.name));
  return { outputs: outputs.map((output, index) => ({ ...output, name: names[index] })), failures };
}
