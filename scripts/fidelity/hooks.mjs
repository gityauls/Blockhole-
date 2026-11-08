// Lets Node run the app's TypeScript modules directly.
// - Resolves extensionless relative imports to .ts.
// - Points pdfjs-dist at its legacy build: the same parser, without browser-only APIs Node 24 lacks.
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "pdfjs-dist") return nextResolve("pdfjs-dist/legacy/build/pdf.mjs", context);
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {}
    }
    return nextResolve(specifier, context);
  },
});

// pdf.js loads its worker from a URL in the browser; in Node, hand it the module directly.
globalThis.pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");

// Pages without text are drawn on a canvas; give Node one that behaves like the browser's.
const { createCanvas } = await import("@napi-rs/canvas");
globalThis.document ??= {
  createElement(tag) {
    if (tag !== "canvas") throw new Error(`hooks.mjs: no <${tag}> in Node`);
    const canvas = createCanvas(1, 1);
    canvas.toBlob = (done, type = "image/png", quality = 0.92) =>
      done(new Blob([type === "image/jpeg" ? canvas.toBuffer("image/jpeg", Math.round(quality * 100)) : canvas.toBuffer("image/png")], { type }));
    return canvas;
  },
};
