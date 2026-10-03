// Errors the upload routes can show to the student as-is. `message` is always safe to display.

export type ExtractErrorCode =
  | "empty_file"
  | "unsupported_type"
  | "not_a_pdf"
  | "pdf_encrypted"
  | "pdf_unreadable"
  | "too_large"
  | "too_many_pages"
  | "bad_page"
  | "ai_unavailable"
  | "no_concepts"
  | "section_not_found"
  | "document_not_found"
  | "section_in_use"
  | "page_not_expected";

const STATUS: Record<ExtractErrorCode, number> = {
  empty_file: 400,
  unsupported_type: 415,
  not_a_pdf: 400,
  pdf_encrypted: 422,
  pdf_unreadable: 422,
  too_large: 413,
  too_many_pages: 422,
  bad_page: 400,
  ai_unavailable: 502,
  no_concepts: 422,
  section_not_found: 404,
  document_not_found: 404,
  section_in_use: 409,
  page_not_expected: 409,
};

export class ExtractError extends Error {
  readonly code: ExtractErrorCode;
  readonly status: number;

  constructor(code: ExtractErrorCode, message: string) {
    super(message);
    this.name = "ExtractError";
    this.code = code;
    this.status = STATUS[code];
  }
}

/** The JSON body and status code a route returns for any error. */
export function errorResponse(error: unknown, fallbackMessage: string): Response {
  if (error instanceof ExtractError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error(fallbackMessage, error);
  return Response.json({ error: fallbackMessage }, { status: 500 });
}
