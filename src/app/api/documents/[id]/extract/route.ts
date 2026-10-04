import { runExtraction } from "@/lib/db/documents";
import { errorResponse } from "@/lib/extract/errors";

// Its own function so reading the PDF and asking Grok do not share one 60 second limit.
export const maxDuration = 60;

/**
 * Turn a finished upload into concepts. The browser calls this after the file
 * (and any scanned pages) are saved, then polls GET /api/sections/:id/upload.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    await runExtraction(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, "Could not read this file");
  }
}
