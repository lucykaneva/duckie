import { describe, expect, it } from "vitest";
import { EXTRACT } from "../src/lib/duck/config";
import { ExtractError } from "../src/lib/extract/errors";
import { checkPageImage, checkUpload, rejectIfHuge, sniffFileKind } from "../src/lib/extract/files";
import { isImagePage, readPdfPages, textLength } from "../src/lib/extract/pages";
import { BINARY_SEARCH_DECK, makePdf } from "./helpers/make-pdf";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as ExtractError).code;
  }
  return undefined;
}

describe("recognising a file by its first bytes", () => {
  it("knows PDFs, JPEGs and PNGs", () => {
    expect(sniffFileKind(makePdf([["hi"]]))).toBe("pdf");
    expect(sniffFileKind(JPEG)).toBe("jpeg");
    expect(sniffFileKind(PNG)).toBe("png");
  });

  it("does not trust anything else", () => {
    expect(sniffFileKind(new TextEncoder().encode("hello, I am a text file"))).toBeNull();
    expect(sniffFileKind(new Uint8Array([]))).toBeNull();
    expect(sniffFileKind(new TextEncoder().encode("%PD"))).toBeNull();
  });
});

describe("checking an upload", () => {
  it("rejects an empty file with a clear message", () => {
    expect(codeOf(() => checkUpload(new Uint8Array(0)))).toBe("empty_file");
  });

  it("rejects an unsupported type, such as a Word file or a text file", () => {
    expect(codeOf(() => checkUpload(new TextEncoder().encode("PK\u0003\u0004 pretend docx")))).toBe(
      "unsupported_type",
    );
  });

  it("rejects a PDF over the limit and says how to fix it", () => {
    const big = new Uint8Array(EXTRACT.maxPdfBytes + 1);
    big.set(makePdf([["x"]]).slice(0, 8));
    try {
      checkUpload(big);
      throw new Error("should have thrown");
    } catch (error) {
      expect((error as ExtractError).code).toBe("too_large");
      expect((error as ExtractError).message).toMatch(/4MB/);
      expect((error as ExtractError).message).toMatch(/photos/);
    }
  });

  it("rejects anything over every limit before reading it", () => {
    expect(codeOf(() => rejectIfHuge(EXTRACT.maxPdfBytes + 1))).toBe("too_large");
    expect(codeOf(() => rejectIfHuge(1_000))).toBeUndefined();
  });

  it("accepts a small PDF and a small photo", () => {
    expect(checkUpload(makePdf([["hi"]]))).toBe("pdf");
    expect(checkUpload(JPEG)).toBe("jpeg");
  });

  it("only accepts JPEG or PNG for a page image", () => {
    expect(checkPageImage(JPEG)).toBe("jpeg");
    expect(codeOf(() => checkPageImage(makePdf([["x"]])))).toBe("bad_page");
    expect(codeOf(() => checkPageImage(new Uint8Array(0)))).toBe("bad_page");
  });
});

describe("deciding which pages are images", () => {
  it("counts only non-space characters", () => {
    expect(textLength("  a b \n c ")).toBe(3);
  });

  it("treats a page with fewer than the minimum characters as an image", () => {
    expect(isImagePage("")).toBe(true);
    expect(isImagePage("   \n  ")).toBe(true);
    expect(isImagePage("x".repeat(EXTRACT.minPageChars - 1))).toBe(true);
    expect(isImagePage("x".repeat(EXTRACT.minPageChars))).toBe(false);
  });
});

describe("reading a PDF page by page", () => {
  it("keeps the text and the page numbers of a typed deck", async () => {
    const pages = await readPdfPages(makePdf(BINARY_SEARCH_DECK));
    expect(pages.map((p) => p.num)).toEqual([1, 2, 3, 4]);
    expect(pages.every((p) => !p.isImage)).toBe(true);
    expect(pages[1].text).toContain("only works when the list is sorted");
    expect(pages[3].text).toContain("lo = mid + 1");
  });

  it("flags blank pages (scans) as image pages while keeping the typed ones: a mixed PDF", async () => {
    const pages = await readPdfPages(
      makePdf([BINARY_SEARCH_DECK[0], [], BINARY_SEARCH_DECK[2], [], []]),
    );
    expect(pages.map((p) => p.isImage)).toEqual([false, true, false, true, true]);
    expect(pages[0].text).toContain("Binary search");
  });

  it("flags every page of an all-scanned PDF, like the Lecture 3 scan", async () => {
    const pages = await readPdfPages(makePdf([[], [], [], [], []]));
    expect(pages).toHaveLength(5);
    expect(pages.every((p) => p.isImage)).toBe(true);
  });

  it("gives a clear error for a file that only pretends to be a PDF", async () => {
    const fake = new TextEncoder().encode("%PDF-1.4\nthis is not really a pdf at all");
    await expect(readPdfPages(fake)).rejects.toMatchObject({ name: "ExtractError" });
    await expect(readPdfPages(fake)).rejects.toThrow(/PDF/);
  });

  it("refuses a PDF with too many pages", async () => {
    const many = makePdf(Array.from({ length: EXTRACT.maxPages + 1 }, (_, i) => [`page ${i + 1} has some text`]));
    await expect(readPdfPages(many)).rejects.toMatchObject({ code: "too_many_pages" });
  });
});
