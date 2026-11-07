import { describe, expect, it } from "vitest";
import {
  MAX_FILE_BYTES,
  formatBytes,
  outputName,
  rejectReason,
  uniqueNames,
} from "./formats";

describe("rejectReason", () => {
  it("accepts supported extensions in any case", () => {
    expect(rejectReason({ name: "a.PNG", size: 10 })).toBeNull();
    expect(rejectReason({ name: "b.c.jpeg", size: 10 })).toBeNull();
  });

  it("rejects unsupported or missing extensions by name", () => {
    expect(rejectReason({ name: "a.pdf", size: 10 })).toContain("a.pdf");
    expect(rejectReason({ name: "noext", size: 10 })).toContain("noext");
  });

  it("rejects empty and oversized files", () => {
    expect(rejectReason({ name: "a.png", size: 0 })).toContain("비어");
    expect(rejectReason({ name: "a.png", size: MAX_FILE_BYTES })).toBeNull();
    expect(rejectReason({ name: "a.png", size: MAX_FILE_BYTES + 1 })).toContain("100MB");
  });
});

describe("outputName", () => {
  it("swaps only the last extension", () => {
    expect(outputName("photo.final.png", "webp")).toBe("photo.final.webp");
  });
  it("appends when the name has no base before the dot", () => {
    expect(outputName(".png", "jpg")).toBe(".png.jpg");
  });
});

describe("uniqueNames", () => {
  it("numbers duplicates without touching unique names", () => {
    expect(uniqueNames(["a.jpg", "b.jpg", "a.jpg", "a.jpg"])).toEqual([
      "a.jpg",
      "b.jpg",
      "a (2).jpg",
      "a (3).jpg",
    ]);
  });
  it("treats names differing only by case as duplicates", () => {
    expect(uniqueNames(["A.jpg", "a.jpg"])).toEqual(["A.jpg", "a (2).jpg"]);
  });
  it("skips a suffix that is already taken", () => {
    expect(uniqueNames(["a.jpg", "a (2).jpg", "a.jpg"])).toEqual([
      "a.jpg",
      "a (2).jpg",
      "a (3).jpg",
    ]);
  });
});

describe("formatBytes", () => {
  it("scales units", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
