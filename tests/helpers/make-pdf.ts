// Builds a small valid PDF for tests: one entry per page, each a list of text lines.
// An empty array makes a blank page (what a scan looks like to a text reader).

const escapeText = (line: string): string => line.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  const pageIds: number[] = [];

  // 1 = catalog, 2 = pages, 3 = font; then each page takes two objects (page, content).
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  pages.forEach((lines, index) => {
    const pageId = 4 + index * 2;
    const contentId = pageId + 1;
    pageIds.push(pageId);
    const body = lines.length
      ? `BT /F1 14 Tf 50 740 Td 18 TL ${lines.map((l) => `(${escapeText(l)}) Tj T*`).join(" ")} ET`
      : "";
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R ` +
      `/Resources << /Font << /F1 3 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${body.length} >>\nstream\n${body}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

/** The binary search deck used across the B8 tests: 4 typed pages. */
export const BINARY_SEARCH_DECK: string[][] = [
  ["Binary search", "Find a value in a list by repeatedly halving the search range."],
  ["Sorted input", "Binary search only works when the list is sorted.", "Sorting lets us discard half the list at each step."],
  [
    "How it halves",
    "Compare the target with the middle item. If the target is bigger, search the right half.",
    "Otherwise search the left half. Repeat until the range is empty.",
  ],
  [
    "The update step",
    "When the middle item is too small set lo = mid + 1, not lo = mid.",
    "Otherwise the search can loop forever when lo and hi are next to each other.",
  ],
];
