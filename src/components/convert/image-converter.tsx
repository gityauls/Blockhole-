"use client";

import { useCallback, useRef, useState } from "react";
import { Portal } from "@/components/convert/portal";
import { useWindowFileDrop } from "@/hooks/use-window-file-drop";
import { convertImage, saveBlob, zipBlobs } from "@/lib/image-convert/convert";
import {
  INPUT_ACCEPT,
  OUTPUT_FORMATS,
  type OutputFormat,
  formatBytes,
  outputName,
  rejectReason,
  uniqueNames,
} from "@/lib/image-convert/formats";

type Item = {
  id: number;
  file: File;
  status: "ready" | "working" | "done" | "error";
  result?: { blob: Blob; name: string };
  error?: string;
};

let nextId = 0;

export function ImageConverter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [format, setFormat] = useState<OutputFormat | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hovering, setHovering] = useState(false);

  const addFiles = useCallback(
    (files: File[]) => {
      if (busy) {
        setNotices(["변환이 끝난 뒤에 파일을 추가해 주세요."]);
        return;
      }
      const rejected = files.map(rejectReason).filter((reason) => reason !== null);
      const accepted = files.filter((file) => rejectReason(file) === null);
      setNotices(rejected);
      setItems((current) => [
        ...current,
        ...accepted.map((file): Item => ({ id: nextId++, file, status: "ready" })),
      ]);
    },
    [busy],
  );

  const dragging = useWindowFileDrop(addFiles);

  const patch = (id: number, change: Partial<Item>) =>
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...change } : item)));

  const chooseFormat = (next: OutputFormat) => {
    setFormat(next);
    setItems((current) =>
      current.map((item) => ({ ...item, status: "ready", result: undefined, error: undefined })),
    );
  };

  const convert = async () => {
    if (!format) return;
    setBusy(true);
    setNotices([]);
    const names = uniqueNames(items.map((item) => outputName(item.file.name, format)));
    for (const [index, item] of items.entries()) {
      if (item.status !== "ready") continue;
      patch(item.id, { status: "working" });
      try {
        const blob = await convertImage(item.file, format);
        patch(item.id, { status: "done", result: { blob, name: names[index] } });
      } catch (error) {
        patch(item.id, {
          status: "error",
          error: error instanceof Error ? error.message : "변환하지 못했습니다.",
        });
      }
    }
    setBusy(false);
  };

  const reset = () => {
    setItems([]);
    setFormat(null);
    setNotices([]);
  };

  const finished = items.flatMap((item) => (item.result ? [item.result] : []));
  const pending = items.some((item) => item.status === "ready");

  const saveAll = async () => {
    if (finished.length === 1) {
      saveBlob(finished[0].blob, finished[0].name);
      return;
    }
    saveBlob(await zipBlobs(finished), "file-blackhole.zip");
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <section
      aria-label="이미지 변환"
      className="mx-auto grid w-full max-w-6xl items-center gap-8 px-5 py-10 md:grid-cols-[minmax(0,1fr)_auto] md:gap-12 md:py-16"
    >
      <input
        ref={inputRef}
        type="file"
        accept={INPUT_ACCEPT}
        multiple
        hidden
        data-testid="file-input"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />

      <div className="min-w-0">
        {items.length === 0 ? (
          <>
            <h1 className="font-display text-4xl leading-[1.3] text-balance lg:text-5xl lg:leading-[1.25]">
              블랙홀에 던지면 원하는 형식으로 나옵니다
            </h1>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-muted-foreground">
              이미지는 브라우저 안에서 변환합니다. 파일은 서버로 올라가지 않습니다.
            </p>
          </>
        ) : (
          <div className="pixel-panel">
            <h1 className="font-display text-2xl">이미지 변환</h1>

            <ul className="mt-4 divide-y divide-border">
              {items.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.result?.name ?? item.file.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {formatBytes(item.file.size)}
                      {item.result && ` → ${formatBytes(item.result.blob.size)}`}
                      {item.status === "working" && " 변환 중"}
                    </p>
                    {item.error && <p className="mt-1 text-sm text-destructive">{item.error}</p>}
                  </div>
                  {item.result ? (
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => item.result && saveBlob(item.result.blob, item.result.name)}
                    >
                      저장
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      aria-label={`${item.file.name} 빼기`}
                      onClick={() =>
                        setItems((current) => current.filter((other) => other.id !== item.id))
                      }
                    >
                      빼기
                    </button>
                  )}
                </li>
              ))}
            </ul>

            <fieldset className="mt-5" disabled={busy}>
              <legend className="font-medium">바꿀 형식</legend>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {OUTPUT_FORMATS.map(({ id, label, hint }) => (
                  <label key={id} className="format-tile">
                    <input
                      type="radio"
                      name="output-format"
                      value={id}
                      className="sr-only"
                      checked={format === id}
                      onChange={() => chooseFormat(id)}
                    />
                    <span className="font-latin text-xl font-bold">{label}</span>
                    <span className="block text-xs">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              {pending || busy ? (
                <button
                  type="button"
                  className="pixel-button"
                  disabled={!format || busy}
                  onClick={convert}
                >
                  {busy ? "변환 중" : "변환하기"}
                </button>
              ) : (
                finished.length > 0 && (
                  <button type="button" className="pixel-button" onClick={saveAll}>
                    {finished.length > 1 ? "모두 저장 (ZIP)" : "저장"}
                  </button>
                )
              )}
              <button type="button" className="text-link" disabled={busy} onClick={openPicker}>
                파일 추가
              </button>
              <button type="button" className="text-link" disabled={busy} onClick={reset}>
                새 작업
              </button>
            </div>
          </div>
        )}

        <div aria-live="polite">
          {notices.map((notice) => (
            <p key={notice} className="mt-3 text-sm text-destructive">
              {notice}
            </p>
          ))}
        </div>
      </div>

      <div
        data-testid="drop-zone"
        className="drop-zone"
        onClick={openPicker}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
      >
        <Portal open={hovering || busy} className="size-80" />
        <button type="button" className="pixel-button">
          파일 선택
        </button>
        <p className="drop-hint mt-3 font-medium">또는 파일을 여기로 끌어다 놓으세요</p>
        <p className="mt-1 text-sm text-muted-foreground">
          JPG, PNG, WEBP, BMP, 파일당 최대 100MB
        </p>
      </div>

      {dragging && (
        <div
          data-testid="drop-overlay"
          className="pointer-events-none fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/90"
        >
          <Portal open className="size-80 lg:size-[480px]" />
          <p className="mt-4 font-display text-4xl">여기에 놓으세요</p>
        </div>
      )}
    </section>
  );
}
