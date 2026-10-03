import { EXTRACT } from "../duck/config";
import { ExtractError } from "./errors";

// Recognising uploads by their first bytes, not by the filename or the browser's claim.

export type FileKind = "pdf" | "jpeg" | "png";

export function sniffFileKind(bytes: Uint8Array): FileKind | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d
  ) {
    return "pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  return null;
}

export const mimeFor = (kind: "jpeg" | "png"): string => (kind === "jpeg" ? "image/jpeg" : "image/png");

const megabytes = (bytes: number): string => (bytes / 1_000_000).toFixed(1).replace(/\.0$/, "");

/** Turn away files that are too big for any kind before reading them into memory. */
export function rejectIfHuge(size: number): void {
  if (size > Math.max(EXTRACT.maxPdfBytes, EXTRACT.maxImageBytes)) {
    throw new ExtractError(
      "too_large",
      `That file is too large. PDFs can be up to ${megabytes(EXTRACT.maxPdfBytes)}MB and photos up to ${megabytes(EXTRACT.maxImageBytes)}MB.`,
    );
  }
}

/** Checks an uploaded file and returns what it is. Throws an ExtractError the student can read. */
export function checkUpload(bytes: Uint8Array): FileKind {
  if (bytes.length === 0) {
    throw new ExtractError("empty_file", "That file is empty. Choose a PDF, or a photo of your notes.");
  }
  const kind = sniffFileKind(bytes);
  if (!kind) {
    throw new ExtractError(
      "unsupported_type",
      "That file type isn't supported. Upload a PDF, or a JPG or PNG photo of your notes.",
    );
  }
  const limit = kind === "pdf" ? EXTRACT.maxPdfBytes : EXTRACT.maxImageBytes;
  if (bytes.length > limit) {
    const mb = megabytes(limit);
    throw new ExtractError(
      "too_large",
      kind === "pdf"
        ? `This PDF is over ${mb}MB. Compress it, or upload photos of the pages instead.`
        : `This image is over ${mb}MB. Use a smaller photo.`,
    );
  }
  return kind;
}

/** A page image sent from the browser: JPEG or PNG, within the size limit. */
export function checkPageImage(bytes: Uint8Array): "jpeg" | "png" {
  if (bytes.length === 0) {
    throw new ExtractError("bad_page", "The page image was empty.");
  }
  const kind = sniffFileKind(bytes);
  if (kind !== "jpeg" && kind !== "png") {
    throw new ExtractError("bad_page", "The page must be a JPEG or PNG image.");
  }
  if (bytes.length > EXTRACT.maxImageBytes) {
    throw new ExtractError("too_large", "That page image is too large. Render it smaller.");
  }
  return kind;
}
