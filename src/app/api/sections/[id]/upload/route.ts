import { after } from "next/server";
import type { UploadJob } from "@/lib/duck/types";
import { beginUpload, getUploadStatus, markFailed, runExtraction, savePageTranscript } from "@/lib/db/documents";
import { ExtractError, errorResponse } from "@/lib/extract/errors";
import { checkUpload, mimeFor, rejectIfHuge } from "@/lib/extract/files";
import { transcribePage } from "@/lib/extract/grok";
import { readPdfPages } from "@/lib/extract/pages";

// Extraction runs after the response, so give the function room to finish.
export const maxDuration = 120;

const SEND_AS_FORM = "Send the file as multipart form data in a field named 'file'.";

/**
 * Start an upload. Send one PDF, or one JPG/PNG photo of notes, as multipart form data.
 * A PDF's typed pages are read here. Pages with no text come back in `imagePagesPending`:
 * the browser renders each to a JPEG and sends it to POST /api/documents/:documentId/pages/:n.
 * A photo is transcribed on the server and needs nothing more from the browser.
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
      const { documentId, readyToExtract } = await beginUpload({
        sectionId,
        filename,
        pages: pages.map((p) => ({ num: p.num, text: p.isImage ? null : p.text })),
      });
      if (readyToExtract) after(() => runExtraction(documentId));

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

    // A photo or screenshot is a one-page document that goes straight to vision.
    const { documentId } = await beginUpload({ sectionId, filename, pages: [{ num: 1, text: null }] });
    after(async () => {
      try {
        const text = await transcribePage({ bytes, mime: mimeFor(kind) });
        const saved = await savePageTranscript(documentId, 1, text);
        if (saved.claimed) await runExtraction(documentId);
      } catch (error) {
        const message =
          error instanceof ExtractError ? error.message : "Couldn't read this image. Try a clearer photo.";
        await markFailed(documentId, message);
      }
    });
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
    if (!job) return Response.json({ error: "Nothing has been uploaded to this section yet." }, { status: 404 });
    return Response.json(job);
  } catch (error) {
    return errorResponse(error, "Could not read the upload status");
  }
}
