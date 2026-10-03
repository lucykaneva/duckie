import { endSession } from "@/lib/db/sessions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof body?.reason === "string" && body.reason.trim() ? body.reason.trim() : "ended";

  try {
    const result = await endSession(id, reason);
    if (result.status === "not_found") {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json(result.move);
  } catch (error) {
    console.error("POST /api/sessions/[id]/end failed", error);
    return Response.json({ error: "Could not end the session" }, { status: 500 });
  }
}
