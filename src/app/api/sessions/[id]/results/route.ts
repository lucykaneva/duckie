import { getSessionResults } from "@/lib/db/sessions";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const results = await getSessionResults(id);
    if (!results) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    return Response.json(results);
  } catch (error) {
    console.error("GET /api/sessions/[id]/results failed", error);
    return Response.json({ error: "Could not load the results" }, { status: 500 });
  }
}
