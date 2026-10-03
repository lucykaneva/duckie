// Must come before pdf-parse: registers the pdf.js worker so it is found in Next and on serverless hosts.
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import { EXTRACT } from "../duck/config";
import { ExtractError } from "./errors";

// Step 1 of upload: read a PDF page by page and decide which pages have no real text
// (scans, handwriting, photos) and so need Grok vision instead.

export interface PdfPage {
  /** 1-based page number. Becomes the slide tag. */
  num: number;
  text: string;
  /** True when the page has too little text to use. */
  isImage: boolean;
}

/** Non-space characters on the page. */
export const textLength = (text: string): number => text.replace(/\s+/g, "").length;

export const isImagePage = (text: string, minChars: number = EXTRACT.minPageChars): boolean =>
  textLength(text) < minChars;

export async function readPdfPages(data: Uint8Array): Promise<PdfPage[]> {
  // pdf-parse takes ownership of the buffer it is given, so hand it a copy.
  const parser = new PDFParse({ data: new Uint8Array(data) });
  try {
    // Without a joiner the per-page text has no "-- 1 of 5 --" footer to count as text.
    const result = await parser.getText({ pageJoiner: "" });
    if (result.total > EXTRACT.maxPages) {
      throw new ExtractError(
        "too_many_pages",
        `This PDF has ${result.total} pages. The limit is ${EXTRACT.maxPages}. Upload a shorter section.`,
      );
    }
    if (result.pages.length === 0) {
      throw new ExtractError("pdf_unreadable", "This PDF has no pages.");
    }
    return result.pages.map((page) => ({
      num: page.num,
      text: page.text.trim(),
      isImage: isImagePage(page.text),
    }));
  } catch (error) {
    if (error instanceof ExtractError) throw error;
    const name = (error as { name?: string } | null)?.name ?? "";
    if (name === "PasswordException") {
      throw new ExtractError("pdf_encrypted", "This PDF is password protected. Remove the password and try again.");
    }
    if (name === "InvalidPDFException" || name === "FormatError" || name === "MissingPDFException") {
      throw new ExtractError("not_a_pdf", "This file isn't a valid PDF, or it is damaged.");
    }
    // The student gets the friendly message; the real cause goes to the server log.
    console.error("readPdfPages failed", error);
    throw new ExtractError("pdf_unreadable", "Couldn't read this PDF. Try saving it again, or upload photos of the pages.");
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}
