import { getSessionLog } from "@/lib/db/sessions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const log = await getSessionLog(id);
    if (!log) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json(log);
  } catch (error) {
    console.error("GET /api/sessions/[id]/log failed", error);
    return Response.json({ error: "Could not load the decision log" }, { status: 500 });
  }
}
