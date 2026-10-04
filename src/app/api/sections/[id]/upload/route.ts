import type { UploadJob } from "@/lib/duck/types";
import { beginUpload, getUploadStatus, markFailed, savePageTranscript } from "@/lib/db/documents";
import { ExtractError, errorResponse } from "@/lib/extract/errors";
import { checkUpload, mimeFor, rejectIfHuge } from "@/lib/extract/files";
import { transcribePage } from "@/lib/extract/grok";
import { readPdfPages } from "@/lib/extract/pages";

// Reading the file only. Concept extraction is a second request so it gets this whole limit.
export const maxDuration = 60;

const SEND_AS_FORM = "Send the file as multipart form data in a field named 'file'.";

/**
 * Start an upload. Send one PDF, or one JPG/PNG photo of notes, as multipart form data.
 * A PDF's typed pages are read here. Pages with no text come back in `imagePagesPending`:
 * the browser renders each to a JPEG and sends it to POST /api/documents/:documentId/pages/:n.
 * A photo is transcribed here. The browser then calls POST /api/documents/:documentId/extract.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: sectionId } = await params;
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) throw new ExtractError("empty_file", SEND_AS_FORM);
    rejectIfHuge(file.size);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = checkUpload(bytes);
    const filename = file.name || (kind === "pdf" ? "upload.pdf" : "photo");

    if (kind === "pdf") {
      const pages = await readPdfPages(bytes);
      const { documentId } = await beginUpload({
        sectionId,
        filename,
        pages: pages.map((p) => ({ num: p.num, text: p.isImage ? null : p.text })),
      });

      const job: UploadJob = {
        status: "processing",
        sectionId,
        documentId,
        filename,
        pageCount: pages.length,
        imagePagesPending: pages.filter((p) => p.isImage).map((p) => p.num),
      };
      return Response.json(job, { status: 202 });
    }

    // A photo is transcribed in this request. Extraction is the browser's next call, so each
    // stays inside the function limit instead of being cut off after the response is sent.
    const { documentId } = await beginUpload({ sectionId, filename, pages: [{ num: 1, text: null }] });
    try {
      const text = await transcribePage({ bytes, mime: mimeFor(kind) });
      await savePageTranscript(documentId, 1, text);
    } catch (error) {
      const message =
        error instanceof ExtractError ? error.message : "Couldn't read this image. Try a clearer photo.";
      await markFailed(documentId, message);
      throw error instanceof ExtractError ? error : new ExtractError("ai_unavailable", message);
    }
    const job: UploadJob = {
      status: "processing",
      sectionId,
      documentId,
      filename,
      pageCount: 1,
      imagePagesPending: [],
    };
    return Response.json(job, { status: 202 });
  } catch (error) {
    return errorResponse(error, "Could not process the upload");
  }
}

/** Poll this. `ready` includes the concept list (no answers); `error` includes a message to show. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const job = await getUploadStatus(id);
    // No file yet. 204, not 404: the upload page asks this on load, and a 404 shows up as a failed request.
    if (!job) return new Response(null, { status: 204 });
    return Response.json(job);
  } catch (error) {
    return errorResponse(error, "Could not read the upload status");
  }
}
