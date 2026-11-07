export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const INPUT_EXTENSIONS = ["bmp", "jpe", "jpeg", "jpg", "png", "webp"];
export const INPUT_ACCEPT = INPUT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

export type OutputFormat = "jpg" | "png" | "webp" | "bmp";

export const OUTPUT_FORMATS: { id: OutputFormat; label: string; hint: string }[] = [
  { id: "jpg", label: "JPG", hint: "사진에 알맞음" },
  { id: "png", label: "PNG", hint: "투명 배경 유지" },
  { id: "webp", label: "WEBP", hint: "웹용, 용량 작음" },
  { id: "bmp", label: "BMP", hint: "무압축" },
];

function extensionOf(name: string): string | null {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

/** Returns why a file can't be used, or null when it is fine. */
export function rejectReason(file: { name: string; size: number }): string | null {
  const ext = extensionOf(file.name);
  if (!ext || !INPUT_EXTENSIONS.includes(ext)) {
    return `${file.name}: 지원하지 않는 형식입니다. JPG, PNG, WEBP, BMP를 넣어 주세요.`;
  }
  if (file.size === 0) return `${file.name}: 파일이 비어 있습니다.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name}: 파일당 100MB까지 넣을 수 있습니다.`;
  return null;
}

export function outputName(name: string, ext: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? `${name.slice(0, dot)}.${ext}` : `${name}.${ext}`;
}

/** Numbers repeated names so a ZIP or a batch of downloads never collides. */
export function uniqueNames(names: string[]): string[] {
  const reserved = new Set(names.map((name) => name.toLowerCase()));
  const seen = new Set<string>();

  return names.map((name) => {
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      return name;
    }
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 2; ; n++) {
      const candidate = `${base} (${n})${ext}`;
      const key = candidate.toLowerCase();
      if (!seen.has(key) && !reserved.has(key)) {
        seen.add(key);
        return candidate;
      }
    }
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
