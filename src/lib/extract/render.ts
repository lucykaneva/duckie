import { EXTRACT } from "../duck/config";
import type { PageRenderer } from "./client";

// Browser only. Draws PDF pages and photos onto a canvas and exports JPEGs, so no image
// libraries are needed on the server. Loaded on demand by client.ts.

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not export the page image."))),
      "image/jpeg",
      EXTRACT.pageImageQuality,
    );
  });
}

function whiteCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  // JPEG has no transparency, so draw on white or transparent areas turn black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

/** Opens a PDF and returns a renderer that draws any page as a JPEG about 1200px wide. */
export async function openPdfRenderer(file: File): Promise<PageRenderer> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  return {
    async render(pageNumber: number): Promise<Blob> {
      const page = await pdf.getPage(pageNumber);
      try {
        const natural = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: EXTRACT.pageImageWidth / natural.width });
        const { canvas, ctx } = whiteCanvas(viewport.width, viewport.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        return await toJpeg(canvas);
      } finally {
        page.cleanup();
      }
    },
    close() {
      void pdf.destroy();
    },
  };
}

/** Scale a photo down to the page width and re-save it as a JPEG. */
export async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, EXTRACT.pageImageWidth / bitmap.width);
    const { canvas, ctx } = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await toJpeg(canvas);
  } finally {
    bitmap.close();
  }
}
