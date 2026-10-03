import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { Concept, UploadJob } from "../duck/types";
import { EXTRACT } from "../duck/config";
import { ExtractError } from "../extract/errors";
import { extractConcepts } from "../extract/extract-concepts";
import type { FetchLike } from "../extract/grok";
import type { ExtractedConcept } from "../extract/validate";
import { getPool } from "./client";

// Uploads: one file per section. Page text is saved page by page because scanned pages are
// transcribed in separate requests. Concepts are replaced only when a new extraction succeeds.

export interface NewPage {
  num: number;
  /** Text read from the PDF, or null when the page is an image waiting for Grok vision. */
  text: string | null;
}

/** Start an upload. Returns whether every page already has text (extraction can start now). */
export async function beginUpload(input: {
  sectionId: string;
  filename: string;
  pages: NewPage[];
}): Promise<{ documentId: string; readyToExtract: boolean }> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const section = await client.query(`SELECT 1 FROM sections WHERE id = $1 FOR UPDATE`, [input.sectionId]);
    if (section.rowCount === 0) {
      throw new ExtractError("section_not_found", "That section doesn't exist.");
    }
    await assertSectionUnused(client, input.sectionId);

    // One file at a time: a new upload replaces an older, possibly unfinished, one.
    await client.query(`DELETE FROM documents WHERE section_id = $1`, [input.sectionId]);

    const documentId = `doc_${randomUUID().slice(0, 8)}`;
    const readyToExtract = input.pages.every((p) => p.text !== null);
    await client.query(
      `INSERT INTO documents (id, section_id, filename, page_count, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [documentId, input.sectionId, input.filename, input.pages.length, readyToExtract ? "extracting" : "awaiting_pages"],
    );
    for (const page of input.pages) {
      await client.query(
        `INSERT INTO document_pages (document_id, page, source, text) VALUES ($1, $2, $3, $4)`,
        [documentId, page.num, page.text === null ? "vision" : "text", page.text],
      );
    }
    await client.query("COMMIT");
    return { documentId, readyToExtract };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function assertSectionUnused(client: PoolClient, sectionId: string): Promise<void> {
  const used = await client.query(`SELECT 1 FROM sessions WHERE section_id = $1 LIMIT 1`, [sectionId]);
  if ((used.rowCount ?? 0) > 0) {
    throw new ExtractError(
      "section_in_use",
      "This section already has practice sessions, so its slides can't be replaced. Create a new section for the new file.",
    );
  }
}

/**
 * Is this scanned page still waiting for its transcription? Throws a readable error when the
 * upload is gone or the page isn't one of its scanned pages. Check this before paying for vision.
 */
export async function pageState(documentId: string, page: number): Promise<"pending" | "done"> {
  const pool = getPool();
  const doc = await pool.query<{ status: string }>(`SELECT status FROM documents WHERE id = $1`, [documentId]);
  if (doc.rowCount === 0) {
    throw new ExtractError("document_not_found", "That upload no longer exists. Start the upload again.");
  }
  const row = await pool.query<{ text: string | null }>(
    `SELECT text FROM document_pages WHERE document_id = $1 AND page = $2 AND source = 'vision'`,
    [documentId, page],
  );
  if (row.rowCount === 0) {
    throw new ExtractError("page_not_expected", `Page ${page} isn't one of the scanned pages for this upload.`);
  }
  if (row.rows[0].text !== null) return "done";
  if (doc.rows[0].status !== "awaiting_pages") {
    throw new ExtractError("page_not_expected", "This upload isn't waiting for more pages.");
  }
  return "pending";
}

/**
 * Save the transcription of one image page. Returns `claimed: true` for exactly one caller:
 * the request that saved the last missing page, which must then start extraction.
 */
export async function savePageTranscript(
  documentId: string,
  page: number,
  text: string,
): Promise<{ claimed: boolean; remaining: number; alreadyDone: boolean }> {
  const pool = getPool();
  const saved = await pool.query(
    `UPDATE document_pages SET text = $3
      WHERE document_id = $1 AND page = $2 AND source = 'vision' AND text IS NULL`,
    [documentId, page, text],
  );
  if (saved.rowCount === 0) {
    // Sent twice (a retry), or the upload was replaced meanwhile: nothing to do.
    return { claimed: false, remaining: await pendingCount(documentId), alreadyDone: true };
  }

  // Atomic: only one request can flip awaiting_pages to extracting.
  const claim = await pool.query(
    `UPDATE documents SET status = 'extracting', status_changed_at = now()
      WHERE id = $1 AND status = 'awaiting_pages'
        AND NOT EXISTS (SELECT 1 FROM document_pages WHERE document_id = $1 AND text IS NULL)
      RETURNING id`,
    [documentId],
  );
  return { claimed: (claim.rowCount ?? 0) > 0, remaining: await pendingCount(documentId), alreadyDone: false };
}

async function pendingCount(documentId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: string }>(
    `SELECT count(*) AS n FROM document_pages WHERE document_id = $1 AND text IS NULL`,
    [documentId],
  );
  return Number(rows[0].n);
}

const FAILED_GENERIC = "Something went wrong reading this file. Try uploading it again.";

export async function markFailed(documentId: string, message: string): Promise<void> {
  await getPool().query(
    `UPDATE documents SET status = 'error', error = $2, status_changed_at = now()
      WHERE id = $1 AND status <> 'ready'`,
    [documentId, message],
  );
}

/** Read the saved pages, ask Grok for concepts, save them. Never throws: failures become status "error". */
export async function runExtraction(documentId: string, fetchImpl?: FetchLike): Promise<void> {
  try {
    const pool = getPool();
    const pages = await pool.query<{ page: number; text: string | null }>(
      `SELECT page, text FROM document_pages WHERE document_id = $1 ORDER BY page`,
      [documentId],
    );
    if (pages.rowCount === 0) return; // replaced by a newer upload meanwhile

    const textPages = pages.rows.map((p) => ({ num: p.page, text: p.text ?? "" }));
    const { concepts, problems } = await extractConcepts(textPages, { fetchImpl });
    if (problems.length > 0) console.warn(`extraction ${documentId}: ${problems.join("; ")}`);

    const rawText = textPages.map((p) => `--- Page ${p.num} ---\n${p.text}`).join("\n\n");
    await saveExtraction(documentId, concepts, rawText);
  } catch (error) {
    if (!(error instanceof ExtractError)) console.error(`extraction ${documentId} failed`, error);
    await markFailed(documentId, error instanceof ExtractError ? error.message : FAILED_GENERIC).catch(
      (e: unknown) => console.error("could not record the failure", e),
    );
  }
}

async function saveExtraction(documentId: string, concepts: ExtractedConcept[], rawText: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const doc = await client.query<{ section_id: string }>(
      `SELECT section_id FROM documents WHERE id = $1 AND status = 'extracting'`,
      [documentId],
    );
    if (doc.rowCount === 0) {
      await client.query("ROLLBACK"); // replaced by a newer upload, nothing to save
      return;
    }
    const sectionId = doc.rows[0].section_id;

    await client.query(`SELECT 1 FROM sections WHERE id = $1 FOR UPDATE`, [sectionId]);
    await assertSectionUnused(client, sectionId);

    await client.query(
      `DELETE FROM concept_secrets WHERE concept_id IN (SELECT id FROM concepts WHERE section_id = $1)`,
      [sectionId],
    );
    await client.query(`DELETE FROM concepts WHERE section_id = $1`, [sectionId]);

    for (const c of concepts) {
      const id = `c_${randomUUID().slice(0, 8)}`;
      await client.query(
        `INSERT INTO concepts
           (id, section_id, topic, name, slide, kind, misconceptions, check_prompt, fallback_questions, plants_misconception)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)`,
        [
          id,
          sectionId,
          c.topic,
          c.name,
          c.slide,
          c.kind,
          JSON.stringify(c.misconceptions),
          c.checkPrompt,
          JSON.stringify(c.fallbackQuestions),
          c.plantsMisconception,
        ],
      );
      if (c.secret) {
        await client.query(
          `INSERT INTO concept_secrets (concept_id, reference_code, expected_answer) VALUES ($1, $2, $3)`,
          [id, c.secret.referenceCode, c.secret.expectedAnswer],
        );
      }
    }

    await client.query(
      `UPDATE documents SET status = 'ready', error = NULL, raw_text = $2, status_changed_at = now()
        WHERE id = $1`,
      [documentId, rawText],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listPublicConcepts(sectionId: string): Promise<Concept[]> {
  const { rows } = await getPool().query<Concept>(
    `SELECT id, topic, name, slide, kind, misconceptions
       FROM concepts WHERE section_id = $1 ORDER BY slide, id`,
    [sectionId],
  );
  return rows;
}

/** Current upload state for a section, or null when there is nothing uploaded and no concepts. */
export async function getUploadStatus(sectionId: string): Promise<UploadJob | null> {
  const pool = getPool();
  const doc = await pool.query<{
    id: string;
    filename: string;
    page_count: number;
    status: string;
    error: string | null;
    stuck: boolean;
  }>(
    `SELECT id, filename, page_count, status, error,
            (status IN ('extracting', 'awaiting_pages')
             AND status_changed_at < now() - ($2::int * interval '1 millisecond')) AS stuck
       FROM documents WHERE section_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sectionId, EXTRACT.extractStuckAfterMs],
  );

  if (doc.rowCount === 0) {
    // Nothing uploaded. A section with seeded concepts still counts as ready.
    const concepts = await listPublicConcepts(sectionId);
    return concepts.length > 0 ? { status: "ready", sectionId, concepts } : null;
  }

  const d = doc.rows[0];
  if (d.stuck) {
    const message = "This took too long and stopped. Try uploading it again.";
    await markFailed(d.id, message);
    return { status: "error", sectionId, documentId: d.id, filename: d.filename, pageCount: d.page_count, error: message };
  }

  const base = { sectionId, documentId: d.id, filename: d.filename, pageCount: d.page_count };
  if (d.status === "error") return { status: "error", ...base, error: d.error ?? FAILED_GENERIC };
  if (d.status === "ready") return { status: "ready", ...base, concepts: await listPublicConcepts(sectionId) };

  const pending = await pool.query<{ page: number }>(
    `SELECT page FROM document_pages WHERE document_id = $1 AND text IS NULL ORDER BY page`,
    [d.id],
  );
  return { status: "processing", ...base, imagePagesPending: pending.rows.map((r) => r.page) };
}
