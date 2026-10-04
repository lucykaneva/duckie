import { runSilence } from "@/lib/db/sessions";

// Dev A's silence timers call this at 8, 20 and 45 s after the duck's last line (spec section 5).
// Soft wait, then offer to skip, then pause. A call that has nothing to do returns 409.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { ms?: unknown } | null;
  const ms = typeof body?.ms === "number" && Number.isFinite(body.ms) ? body.ms : null;
  if (ms === null) {
    return Response.json({ error: "ms is required" }, { status: 400 });
  }

  try {
    const result = await runSilence(id, ms);
    switch (result.status) {
      case "not_found":
        return Response.json({ error: "Session not found" }, { status: 404 });
      case "ended":
        return Response.json({ error: "Session has ended" }, { status: 409 });
      case "too_short":
        return Response.json({ error: "ms is shorter than the first silence step" }, { status: 400 });
      case "stale":
        return Response.json({ error: "Nothing to do for this silence" }, { status: 409 });
      default:
        return Response.json(result.move);
    }
  } catch (error) {
    console.error("POST /api/sessions/[id]/silence failed", error);
    return Response.json({ error: "Could not process the silence" }, { status: 500 });
  }
}
