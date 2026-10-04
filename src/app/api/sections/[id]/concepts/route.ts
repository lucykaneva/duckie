import { getPool } from "@/lib/db/client";
import type { Concept } from "@/lib/duck/types";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    // Explicit columns only. Never select from concept_secrets, and never
    // return check_prompt or fallback_questions (the engine uses those).
    const { rows } = await getPool().query<Concept>(
      `SELECT c.id, c.topic, c.name, c.slide, c.kind, c.misconceptions,
              c.document_id AS "documentId", d.filename
         FROM concepts c
         LEFT JOIN documents d ON d.id = c.document_id
        WHERE c.section_id = $1
        ORDER BY c.slide, c.id`,
      [id],
    );
    return Response.json(rows);
  } catch (error) {
    console.error("GET /api/sections/[id]/concepts failed", error);
    return Response.json({ error: "Could not load concepts" }, { status: 500 });
  }
}
