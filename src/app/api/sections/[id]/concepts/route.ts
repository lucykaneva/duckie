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
      `SELECT id, topic, name, slide, kind, misconceptions
         FROM concepts
        WHERE section_id = $1
        ORDER BY slide, id`,
      [id],
    );
    return Response.json(rows);
  } catch (error) {
    console.error("GET /api/sections/[id]/concepts failed", error);
    return Response.json({ error: "Could not load concepts" }, { status: 500 });
  }
}
