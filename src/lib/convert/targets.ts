import { type FileKind, fileKind, rejectReason } from "../image-convert/formats";

export type TargetId =
  | "jpg"
  | "png"
  | "webp"
  | "bmp"
  | "pdf"
  | "pdf-merge"
  | "pdf-split"
  | "pdf-jpg"
  | "pdf-txt";

export type Target = {
  id: TargetId;
  label: string;
  hint: string;
  action: string;
  /** The order of the input files changes the result. */
  ordered?: boolean;
};

const IMAGE_TARGETS: Target[] = [
  { id: "jpg", label: "JPG", hint: "사진에 알맞음", action: "변환하기" },
  { id: "png", label: "PNG", hint: "투명 배경 유지", action: "변환하기" },
  { id: "webp", label: "WEBP", hint: "웹용, 용량 작음", action: "변환하기" },
  { id: "bmp", label: "BMP", hint: "무압축", action: "변환하기" },
  { id: "pdf", label: "PDF", hint: "이미지를 PDF 하나로", action: "PDF 만들기", ordered: true },
];

const MERGE_TARGET: Target = {
  id: "pdf-merge",
  label: "합치기",
  hint: "PDF 하나로",
  action: "합치기",
  ordered: true,
};

const PDF_TARGETS: Target[] = [
  { id: "pdf-split", label: "나누기", hint: "페이지별 또는 범위", action: "나누기" },
  { id: "pdf-jpg", label: "JPG", hint: "페이지를 이미지로", action: "변환하기" },
  { id: "pdf-txt", label: "TXT", hint: "글자만 추출", action: "변환하기" },
];

export function targetsFor(kind: FileKind, fileCount: number): Target[] {
  if (kind === "image") return IMAGE_TARGETS;
  return fileCount > 1 ? [MERGE_TARGET, ...PDF_TARGETS] : PDF_TARGETS;
}

/** Splits dropped files into what can join the current list and why the rest can't. */
export function sortIntoKind<T extends { name: string; size: number }>(
  files: T[],
  current: FileKind | null,
): { kind: FileKind | null; accepted: T[]; rejected: string[] } {
  let kind = current;
  const accepted: T[] = [];
  const rejected: string[] = [];

  for (const file of files) {
    const reason = rejectReason(file);
    if (reason) {
      rejected.push(reason);
      continue;
    }
    const fileType = fileKind(file.name);
    kind ??= fileType;
    if (fileType === kind) accepted.push(file);
    else rejected.push(`${file.name}: 이미지와 PDF는 따로 넣어 주세요.`);
  }

  return { kind, accepted, rejected };
}
