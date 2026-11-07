import { describe, expect, it } from "vitest";
import { sortIntoKind, targetsFor } from "./targets";

const file = (name: string, size = 10) => ({ name, size });

describe("targetsFor", () => {
  it("offers image formats and PDF for images", () => {
    expect(targetsFor("image", 1).map((t) => t.id)).toEqual(["jpg", "png", "webp", "bmp", "pdf"]);
  });

  it("offers merging only with two or more PDFs", () => {
    expect(targetsFor("pdf", 1).map((t) => t.id)).toEqual(["pdf-split", "pdf-jpg", "pdf-txt"]);
    expect(targetsFor("pdf", 2).map((t) => t.id)).toContain("pdf-merge");
  });
});

describe("sortIntoKind", () => {
  it("takes its kind from the first valid file", () => {
    const { kind, accepted, rejected } = sortIntoKind([file("a.png"), file("b.jpg")], null);
    expect(kind).toBe("image");
    expect(accepted).toHaveLength(2);
    expect(rejected).toEqual([]);
  });

  it("keeps out a different kind and says why", () => {
    const { accepted, rejected } = sortIntoKind([file("a.png"), file("b.pdf")], null);
    expect(accepted.map((f) => f.name)).toEqual(["a.png"]);
    expect(rejected[0]).toContain("b.pdf");
    expect(rejected[0]).toContain("따로");
  });

  it("respects the kind already in the list", () => {
    const { accepted, rejected } = sortIntoKind([file("a.png")], "pdf");
    expect(accepted).toEqual([]);
    expect(rejected).toHaveLength(1);
  });

  it("reports unsupported files", () => {
    const { kind, rejected } = sortIntoKind([file("a.docx")], null);
    expect(kind).toBeNull();
    expect(rejected[0]).toContain("a.docx");
  });
});
