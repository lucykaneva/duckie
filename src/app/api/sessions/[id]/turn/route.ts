import { runTurn } from "@/lib/db/sessions";
import { emptyJudgeResult } from "@/lib/engine/stub-judge";

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as {
    text?: unknown;
    startedAt?: unknown;
    endedAt?: unknown;
  } | null;

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }

  try {
    // B7: the judge is stubbed to an empty result. B11 swaps in Dev A's judgeTurn.
    const result = await runTurn(
      id,
      { text, startedAt: parseDate(body?.startedAt), endedAt: parseDate(body?.endedAt) },
      emptyJudgeResult(),
    );
    if (result.status === "not_found") {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    if (result.status === "ended") {
      return Response.json({ error: "Session has ended" }, { status: 409 });
    }
    return Response.json(result.move);
  } catch (error) {
    console.error("POST /api/sessions/[id]/turn failed", error);
    return Response.json({ error: "Could not process the turn" }, { status: 500 });
  }
}
