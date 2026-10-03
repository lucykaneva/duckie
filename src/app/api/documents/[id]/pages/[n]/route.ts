import { after } from "next/server";
import { pageState, runExtraction, savePageTranscript } from "@/lib/db/documents";
import { ExtractError, errorResponse } from "@/lib/extract/errors";
import { checkPageImage, mimeFor } from "@/lib/extract/files";
import { transcribePage } from "@/lib/extract/grok";

export const maxDuration = 60;

/**
 * Send one scanned page as the raw request body (Content-Type image/jpeg, about 1200px wide).
 * Grok vision transcribes it and the text is saved as that page. When the last scanned page
 * arrives, extraction starts by itself; poll GET /api/sections/:id/upload for the result.
 * Safe to send again if a request failed or was repeated.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const { id: documentId, n } = await params;
  try {
    const page = Number(n);
    if (!Number.isInteger(page) || page < 1) {
      throw new ExtractError("bad_page", "The page number must be a whole number from 1.");
    }

    const state = await pageState(documentId, page);
    if (state === "done") return Response.json({ page, alreadyDone: true });

    const bytes = new Uint8Array(await request.arrayBuffer());
    const kind = checkPageImage(bytes);
    const text = await transcribePage({ bytes, mime: mimeFor(kind) });
    const saved = await savePageTranscript(documentId, page, text);
    if (saved.claimed) after(() => runExtraction(documentId));

    return Response.json({ page, remaining: saved.remaining, extracting: saved.claimed });
  } catch (error) {
    return errorResponse(error, "Could not process the page");
  }
}
