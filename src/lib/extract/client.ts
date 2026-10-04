import { EXTRACT } from "../duck/config";
import type { UploadJob } from "../duck/types";

// Browser side of an upload. The upload page calls `uploadToSection` and shows the progress.
//
//   const job = await uploadToSection(sectionId, file, { onProgress });   // job.concepts when done
//
// What happens: the file goes to the server; any scanned pages (no text) are drawn here with
// pdf.js and sent one JPEG per request, a few at a time; then this polls until the concept list
// is ready. It throws an UploadError whose message is safe to show the student.

export class UploadError extends Error {
  readonly code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "UploadError";
    this.code = code;
  }
}

export type UploadPhase = "uploading" | "reading_pages" | "analysing" | "done";

export interface UploadProgress {
  phase: UploadPhase;
  /** Scanned pages sent so far. */
  pagesDone: number;
  /** Scanned pages that need sending (0 for a typed PDF or a photo). */
  pagesTotal: number;
}

/** Draws pages of one PDF to JPEG images. Created once per file. */
export interface PageRenderer {
  render(page: number): Promise<Blob>;
  close(): void;
}

export interface UploadOptions {
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  /** For tests. */
  fetchImpl?: typeof fetch;
  openRenderer?: (file: File) => Promise<PageRenderer>;
  shrinkImage?: (file: File) => Promise<Blob>;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

const DEFAULT_POLL_MS = 1_500;
const DEFAULT_POLL_TIMEOUT_MS = 4 * 60_000;

const isPdf = (file: File): boolean => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

async function failFrom(response: Response, fallback: string): Promise<never> {
  const body = await readJson(response);
  throw new UploadError(typeof body.error === "string" ? body.error : fallback, body.code as string | undefined);
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new UploadError("Upload cancelled."));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new UploadError("Upload cancelled."));
    });
  });

export async function uploadToSection(
  sectionId: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadJob> {
  const doFetch = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const progress = (phase: UploadPhase, pagesDone = 0, pagesTotal = 0) =>
    options.onProgress?.({ phase, pagesDone, pagesTotal });

  progress("uploading");

  // A phone photo is often bigger than the server accepts; shrink it first.
  let toSend: Blob = file;
  if (!isPdf(file) && file.size > EXTRACT.maxImageBytes) {
    const shrink = options.shrinkImage ?? (await import("./render")).shrinkImage;
    toSend = await shrink(file);
  }

  const form = new FormData();
  form.append("file", toSend, file.name);
  const started = await doFetch(`/api/sections/${sectionId}/upload`, {
    method: "POST",
    body: form,
    signal: options.signal,
  });
  if (!started.ok) await failFrom(started, "The upload failed. Try again.");
  const job = (await started.json()) as UploadJob;

  const pending = job.imagePagesPending ?? [];
  if (pending.length > 0 && job.documentId) {
    const open = options.openRenderer ?? (await import("./render")).openPdfRenderer;
    await sendScannedPages(job.documentId, pending, await open(file), doFetch, options, progress);
  }

  // Extraction is its own request. Doing it inside the upload meant Vercel cut the
  // function off once the file was saved, and the duck reported that Grok never answered.
  if (job.documentId) {
    const extracted = await doFetch(`/api/documents/${job.documentId}/extract`, {
      method: "POST",
      signal: options.signal,
    });
    if (!extracted.ok && extracted.status !== 204) {
      await failFrom(extracted, "Couldn't read this file. Try again.");
    }
  }

  progress("analysing", pending.length, pending.length);
  const finished = await pollUntilDone(sectionId, doFetch, options);
  progress("done", pending.length, pending.length);
  return finished;
}

async function sendScannedPages(
  documentId: string,
  pages: number[],
  renderer: PageRenderer,
  doFetch: typeof fetch,
  options: UploadOptions,
  progress: (phase: UploadPhase, done?: number, total?: number) => void,
): Promise<void> {
  const queue = [...pages];
  let done = 0;
  let failure: unknown = null;
  progress("reading_pages", 0, pages.length);

  const sendOne = async (page: number): Promise<void> => {
    const image = await renderer.render(page);
    // One retry covers a dropped connection or a busy AI service; 4xx errors are final.
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await doFetch(`/api/documents/${documentId}/pages/${page}`, {
          method: "POST",
          headers: { "content-type": "image/jpeg" },
          body: image,
          signal: options.signal,
        });
      } catch (error) {
        if (attempt === 1 || options.signal?.aborted) throw error;
        continue;
      }
      if (response.ok) return;
      if (response.status < 500 || attempt === 1) {
        await failFrom(response, `Couldn't read page ${page}. Try again.`);
      }
    }
  };

  const worker = async (): Promise<void> => {
    while (!failure) {
      const page = queue.shift();
      if (page === undefined) return;
      try {
        await sendOne(page);
        done += 1;
        progress("reading_pages", done, pages.length);
      } catch (error) {
        failure ??= error;
      }
    }
  };

  try {
    const workers = Math.min(EXTRACT.pagesInParallel, pages.length);
    await Promise.all(Array.from({ length: workers }, worker));
  } finally {
    renderer.close();
  }
  if (failure) {
    throw failure instanceof UploadError
      ? failure
      : new UploadError("Couldn't send the scanned pages. Check your connection and try again.");
  }
}

async function pollUntilDone(
  sectionId: string,
  doFetch: typeof fetch,
  options: UploadOptions,
): Promise<UploadJob> {
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS);

  while (Date.now() < deadline) {
    const response = await doFetch(`/api/sections/${sectionId}/upload`, { signal: options.signal });
    if (!response.ok) await failFrom(response, "Couldn't check the upload. Try again.");
    const job = (await response.json()) as UploadJob;
    if (job.status === "ready") return job;
    if (job.status === "error") {
      throw new UploadError(job.error ?? "Something went wrong reading this file. Try uploading it again.");
    }
    await sleep(interval, options.signal);
  }
  throw new UploadError("This is taking too long. Try uploading it again.");
}
