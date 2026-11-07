"use client";

import { useRef, useState } from "react";
import { Portal } from "@/components/convert/portal";
import { useWindowFileDrop } from "@/hooks/use-window-file-drop";
import { type Output, runTarget } from "@/lib/convert/run";
import { type TargetId, sortIntoKind, targetsFor } from "@/lib/convert/targets";
import { saveBlob, zipBlobs } from "@/lib/image-convert/convert";
import {
  type FileKind,
  INPUT_ACCEPT,
  fileKind,
  formatBytes,
} from "@/lib/image-convert/formats";

type Item = { id: number; file: File };

let nextId = 0;

export function FileConverter() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [targetId, setTargetId] = useState<TargetId | null>(null);
  const [ranges, setRanges] = useState("");
  const [outputs, setOutputs] = useState<Output[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);

  const busy = progress !== null;
  const kind: FileKind | null = items[0] ? fileKind(items[0].file.name) : null;
  const targets = kind ? targetsFor(kind, items.length) : [];
  const target = targets.find((candidate) => candidate.id === targetId) ?? null;

  const clearResults = () => {
    setOutputs([]);
    setFailures([]);
  };

  const addFiles = (files: File[]) => {
    if (busy) {
      setNotices(["작업이 끝난 뒤에 파일을 추가해 주세요."]);
      return;
    }
    const { accepted, rejected } = sortIntoKind(files, kind);
    setNotices(rejected);
    if (accepted.length === 0) return;
    clearResults();
    setItems((current) => [...current, ...accepted.map((file) => ({ id: nextId++, file }))]);
  };

  const dragging = useWindowFileDrop(addFiles);

  const removeItem = (id: number) => {
    clearResults();
    setItems((current) => current.filter((item) => item.id !== id));
  };

  const moveUp = (index: number) => {
    clearResults();
    setItems((current) => {
      const next = [...current];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  };

  const run = async () => {
    if (!target) return;
    setNotices([]);
    clearResults();
    setProgress("");
    const result = await runTarget(
      items.map((item) => item.file),
      target.id,
      { ranges, onProgress: setProgress },
    );
    setOutputs(result.outputs);
    setFailures(result.failures);
    setProgress(null);
  };

  const reset = () => {
    setItems([]);
    setTargetId(null);
    setRanges("");
    setNotices([]);
    clearResults();
  };

  const saveAll = async () => {
    if (outputs.length === 1) {
      saveBlob(outputs[0].blob, outputs[0].name);
      return;
    }
    saveBlob(await zipBlobs(outputs), "file-blackhole.zip");
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <section
      aria-label="파일 변환"
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
              파일은 브라우저 안에서 처리합니다. 서버로 올라가지 않습니다.
            </p>
          </>
        ) : (
          <div className="panel">
            <h1 className="font-display text-2xl">
              {kind === "pdf" ? "PDF 작업" : "이미지 변환"}
            </h1>

            <ul className="mt-4 max-h-64 divide-y divide-border overflow-y-auto">
              {items.map((item, index) => (
                <li key={item.id} className="flex items-center gap-3 py-3 pr-1">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.file.name}</p>
                    <p className="text-sm text-muted-foreground">{formatBytes(item.file.size)}</p>
                  </div>
                  {target?.ordered && index > 0 && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      aria-label={`${item.file.name} 위로`}
                      onClick={() => moveUp(index)}
                    >
                      위로
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-link"
                    disabled={busy}
                    aria-label={`${item.file.name} 빼기`}
                    onClick={() => removeItem(item.id)}
                  >
                    빼기
                  </button>
                </li>
              ))}
            </ul>

            <fieldset className="mt-5" disabled={busy}>
              <legend className="font-medium">할 일</legend>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {targets.map(({ id, label, hint }) => (
                  <label key={id} className="format-tile">
                    <input
                      type="radio"
                      name="target"
                      value={id}
                      className="sr-only"
                      checked={targetId === id}
                      onChange={() => {
                        clearResults();
                        setTargetId(id);
                      }}
                    />
                    <span
                      className={/^[A-Z]+$/.test(label) ? "font-latin text-xl font-bold" : "text-xl font-bold"}
                    >
                      {label}
                    </span>
                    <span className="block text-xs">{hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {targetId === "pdf-split" && (
              <label className="mt-4 block">
                <span className="text-sm text-muted-foreground">
                  가져올 페이지 (비워 두면 한 쪽씩 나눕니다)
                </span>
                <input
                  type="text"
                  value={ranges}
                  disabled={busy}
                  placeholder="예: 1-3, 5"
                  className="mt-1 block w-full rounded-lg border border-border bg-card px-3 py-2"
                  onChange={(event) => {
                    clearResults();
                    setRanges(event.target.value);
                  }}
                />
              </label>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-4">
              {outputs.length > 0 ? (
                <button type="button" className="primary-button" onClick={saveAll}>
                  {outputs.length > 1 ? "모두 저장 (ZIP)" : "저장"}
                </button>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={!target || busy}
                  onClick={run}
                >
                  {busy ? "처리 중" : (target?.action ?? "할 일을 고르세요")}
                </button>
              )}
              <button type="button" className="text-link" disabled={busy} onClick={openPicker}>
                파일 추가
              </button>
              <button type="button" className="text-link" disabled={busy} onClick={reset}>
                새 작업
              </button>
            </div>

            {progress && <p className="mt-3 text-sm text-muted-foreground">{progress}</p>}

            {outputs.length > 0 && (
              <div className="mt-5 border-t border-border pt-4">
                <h2 className="font-medium">결과 {outputs.length}개</h2>
                <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto">
                  {outputs.map((output) => (
                    <li key={output.name} className="flex items-center gap-3 py-2 pr-1">
                      <div className="min-w-0 flex-1">
                        <p className="truncate">{output.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatBytes(output.blob.size)}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="text-link"
                        aria-label={`${output.name} 저장`}
                        onClick={() => saveBlob(output.blob, output.name)}
                      >
                        저장
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div aria-live="polite">
          {[...notices, ...failures].map((message) => (
            <p key={message} className="mt-3 text-sm text-destructive">
              {message}
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
        <button type="button" className="primary-button">
          파일 선택
        </button>
        <p className="drop-hint mt-3 font-medium">또는 파일을 여기로 끌어다 놓으세요</p>
        <p className="mt-1 text-sm text-muted-foreground">
          JPG, PNG, WEBP, BMP, PDF, 파일당 최대 100MB
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
