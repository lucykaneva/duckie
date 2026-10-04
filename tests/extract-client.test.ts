import { describe, expect, it } from "vitest";
import { EXTRACT } from "../src/lib/duck/config";
import type { UploadJob } from "../src/lib/duck/types";
import { UploadError, uploadToSection } from "../src/lib/extract/client";
import type { PageRenderer, UploadProgress } from "../src/lib/extract/client";

// A fake server and a fake page renderer, so the browser flow can be tested without a browser.

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const READY: UploadJob = {
  status: "ready",
  sectionId: "sec_x",
  concepts: [{ id: "c_1", topic: "T", name: "N", slide: 1, kind: "explain", misconceptions: [] }],
};

interface Call {
  url: string;
  method: string;
  contentType?: string;
}

function server(options: {
  start: Response | (() => Response);
  pageResponses?: (page: number, attempt: number) => Response;
  polls?: Response[];
}) {
  const calls: Call[] = [];
  const attempts = new Map<number, number>();
  let inFlight = 0;
  let maxInFlight = 0;
  const polls = [...(options.polls ?? [json(READY)])];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, contentType: headers["content-type"] });

    if (url.endsWith("/upload") && method === "POST") {
      return typeof options.start === "function" ? options.start() : options.start.clone();
    }
    if (url.endsWith("/extract") && method === "POST") return new Response(null, { status: 204 });
    if (url.endsWith("/upload")) return (polls.length > 1 ? polls.shift()! : polls[0]).clone();

    const page = Number(url.split("/").pop());
    const attempt = (attempts.get(page) ?? 0) + 1;
    attempts.set(page, attempt);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    return options.pageResponses ? options.pageResponses(page, attempt) : json({ page });
  }) as typeof fetch;

  return { fetchImpl, calls, maxInFlight: () => maxInFlight };
}

function renderer() {
  const rendered: number[] = [];
  let closed = false;
  const impl: PageRenderer = {
    async render(page) {
      rendered.push(page);
      return new Blob([new Uint8Array([0xff, 0xd8, 0xff, page])], { type: "image/jpeg" });
    },
    close() {
      closed = true;
    },
  };
  return { impl, rendered, isClosed: () => closed };
}

const pdfFile = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "notes.pdf", { type: "application/pdf" });
const fast = { pollIntervalMs: 1 };

describe("uploading a typed PDF", () => {
  it("sends the file, never opens the page renderer, and returns the concepts when ready", async () => {
    const s = server({
      start: json({ status: "processing", sectionId: "sec_x", documentId: "doc_1", imagePagesPending: [] }, 202),
      polls: [json({ status: "processing", sectionId: "sec_x" }), json(READY)],
    });
    const progress: UploadProgress[] = [];
    let opened = false;
    const job = await uploadToSection("sec_x", pdfFile, {
      ...fast,
      fetchImpl: s.fetchImpl,
      onProgress: (p) => progress.push(p),
      openRenderer: async () => {
        opened = true;
        return renderer().impl;
      },
    });
    expect(opened).toBe(false);
    expect(job.concepts).toHaveLength(1);
    expect(s.calls[0]).toMatchObject({ url: "/api/sections/sec_x/upload", method: "POST" });
    expect(s.calls).toContainEqual(expect.objectContaining({ url: "/api/documents/doc_1/extract", method: "POST" }));
    expect(progress.map((p) => p.phase)).toEqual(["uploading", "analysing", "done"]);
  });
});

describe("uploading a scanned PDF", () => {
  const pending = [1, 2, 3, 4, 5, 6, 7];
  const startScan = () =>
    json({ status: "processing", sectionId: "sec_x", documentId: "doc_9", imagePagesPending: pending }, 202);

  it("renders and sends every scanned page, in parallel but not too many at once", async () => {
    const s = server({ start: startScan() });
    const r = renderer();
    const progress: UploadProgress[] = [];
    await uploadToSection("sec_x", pdfFile, {
      ...fast,
      fetchImpl: s.fetchImpl,
      openRenderer: async () => r.impl,
      onProgress: (p) => progress.push(p),
    });

    expect([...r.rendered].sort()).toEqual(pending);
    const pageCalls = s.calls.filter((c) => c.url.includes("/api/documents/doc_9/pages/"));
    expect(pageCalls.map((c) => Number(c.url.split("/").pop())).sort()).toEqual(pending);
    expect(pageCalls.every((c) => c.method === "POST" && c.contentType === "image/jpeg")).toBe(true);
    expect(s.maxInFlight()).toBeGreaterThan(1);
    expect(s.maxInFlight()).toBeLessThanOrEqual(EXTRACT.pagesInParallel);
    expect(r.isClosed()).toBe(true);

    const reading = progress.filter((p) => p.phase === "reading_pages");
    expect(reading[0]).toMatchObject({ pagesDone: 0, pagesTotal: 7 });
    expect(reading.at(-1)).toMatchObject({ pagesDone: 7, pagesTotal: 7 });
  });

  it("retries a page once after a server error", async () => {
    const s = server({
      start: startScan(),
      pageResponses: (page, attempt) => (page === 3 && attempt === 1 ? json({ error: "busy" }, 502) : json({ page })),
    });
    await uploadToSection("sec_x", pdfFile, { ...fast, fetchImpl: s.fetchImpl, openRenderer: async () => renderer().impl });
    expect(s.calls.filter((c) => c.url.endsWith("/pages/3"))).toHaveLength(2);
  });

  it("retries once after a dropped connection", async () => {
    const s = server({ start: startScan() });
    let first = true;
    const flaky = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/pages/2") && first) {
        first = false;
        throw new TypeError("network down");
      }
      return s.fetchImpl(input, init);
    }) as typeof fetch;
    await uploadToSection("sec_x", pdfFile, { ...fast, fetchImpl: flaky, openRenderer: async () => renderer().impl });
    expect(first).toBe(false);
  });

  it("stops and shows the server's message when a page is refused, without retrying it", async () => {
    const s = server({
      start: startScan(),
      pageResponses: (page) =>
        page === 2 ? json({ error: "That page image is too large. Render it smaller.", code: "too_large" }, 413) : json({ page }),
    });
    const r = renderer();
    const error = await uploadToSection("sec_x", pdfFile, {
      ...fast,
      fetchImpl: s.fetchImpl,
      openRenderer: async () => r.impl,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).message).toBe("That page image is too large. Render it smaller.");
    expect((error as UploadError).code).toBe("too_large");
    expect(s.calls.filter((c) => c.url.endsWith("/pages/2"))).toHaveLength(1);
    expect(r.isClosed()).toBe(true);
    // It did not go on to poll for results after the failure.
    expect(s.calls.some((c) => c.url.endsWith("/upload") && c.method === "GET")).toBe(false);
  });

  it("gives up after a second server error and says so", async () => {
    const s = server({ start: startScan(), pageResponses: (page) => (page === 4 ? json({ error: "AI down" }, 502) : json({ page })) });
    await expect(
      uploadToSection("sec_x", pdfFile, { ...fast, fetchImpl: s.fetchImpl, openRenderer: async () => renderer().impl }),
    ).rejects.toThrow("AI down");
    expect(s.calls.filter((c) => c.url.endsWith("/pages/4"))).toHaveLength(2);
  });
});

describe("uploading a photo", () => {
  const startPhoto = () =>
    json({ status: "processing", sectionId: "sec_x", documentId: "doc_p", imagePagesPending: [] }, 202);

  it("sends a small photo as it is, with no page rendering", async () => {
    const s = server({ start: startPhoto() });
    const photo = new File([new Uint8Array(1_000)], "notes.jpg", { type: "image/jpeg" });
    let shrunk = false;
    await uploadToSection("sec_x", photo, {
      ...fast,
      fetchImpl: s.fetchImpl,
      shrinkImage: async () => {
        shrunk = true;
        return new Blob();
      },
      openRenderer: async () => {
        throw new Error("should not open a PDF renderer for a photo");
      },
    });
    expect(shrunk).toBe(false);
  });

  it("shrinks a photo that is too big for the server before sending it", async () => {
    const s = server({ start: startPhoto() });
    const big = new File([new Uint8Array(EXTRACT.maxImageBytes + 1)], "huge.jpg", { type: "image/jpeg" });
    let sentSize = -1;
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST" && String(input).endsWith("/upload")) {
        sentSize = ((init.body as FormData).get("file") as Blob).size;
      }
      return s.fetchImpl(input, init);
    }) as typeof fetch;
    await uploadToSection("sec_x", big, {
      ...fast,
      fetchImpl: spy,
      shrinkImage: async () => new Blob([new Uint8Array(200_000)], { type: "image/jpeg" }),
    });
    expect(sentSize).toBe(200_000);
  });
});

describe("errors", () => {
  it("shows the server's message when the upload is refused", async () => {
    const s = server({
      start: json({ error: "This PDF is over 4MB. Compress it, or upload photos of the pages instead.", code: "too_large" }, 413),
    });
    const error = await uploadToSection("sec_x", pdfFile, { ...fast, fetchImpl: s.fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect((error as UploadError).message).toMatch(/over 4MB/);
    expect((error as UploadError).code).toBe("too_large");
  });

  it("has a safe message when the server sends no usable error", async () => {
    const s = server({ start: new Response("<html>oops</html>", { status: 500 }) });
    await expect(uploadToSection("sec_x", pdfFile, { ...fast, fetchImpl: s.fetchImpl })).rejects.toThrow(
      "The upload failed. Try again.",
    );
  });

  it("throws the extraction error when processing fails", async () => {
    const s = server({
      start: json({ status: "processing", sectionId: "sec_x", documentId: "d", imagePagesPending: [] }, 202),
      polls: [json({ status: "error", sectionId: "sec_x", error: "Couldn't find concepts to practise in this file." })],
    });
    await expect(uploadToSection("sec_x", pdfFile, { ...fast, fetchImpl: s.fetchImpl })).rejects.toThrow(
      "Couldn't find concepts to practise in this file.",
    );
  });

  it("stops waiting after the timeout", async () => {
    const s = server({
      start: json({ status: "processing", sectionId: "sec_x", documentId: "d", imagePagesPending: [] }, 202),
      polls: [json({ status: "processing", sectionId: "sec_x" })],
    });
    await expect(
      uploadToSection("sec_x", pdfFile, { fetchImpl: s.fetchImpl, pollIntervalMs: 2, pollTimeoutMs: 30 }),
    ).rejects.toThrow(/taking too long/);
  });

  it("can be cancelled", async () => {
    const s = server({
      start: json({ status: "processing", sectionId: "sec_x", documentId: "d", imagePagesPending: [] }, 202),
      polls: [json({ status: "processing", sectionId: "sec_x" })],
    });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(
      uploadToSection("sec_x", pdfFile, { fetchImpl: s.fetchImpl, pollIntervalMs: 5, signal: controller.signal }),
    ).rejects.toThrow(/cancelled/);
  });
});
