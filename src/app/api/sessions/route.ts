import { createSession } from "@/lib/db/sessions";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    sectionId?: unknown;
    topic?: unknown;
    confidence?: unknown;
  } | null;

  const sectionId = typeof body?.sectionId === "string" ? body.sectionId.trim() : "";
  const topic = typeof body?.topic === "string" ? body.topic.trim() : "";
  const confidence = body?.confidence;

  if (!sectionId || !topic) {
    return Response.json({ error: "sectionId and topic are required" }, { status: 400 });
  }
  if (typeof confidence !== "number" || !Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
    return Response.json({ error: "confidence must be a whole number from 1 to 5" }, { status: 400 });
  }

  try {
    const session = await createSession({ sectionId, topic, confidence });
    if (!session) {
      return Response.json({ error: "Section not found or it has no concepts" }, { status: 404 });
    }
    return Response.json(session, { status: 201 });
  } catch (error) {
    console.error("POST /api/sessions failed", error);
    return Response.json({ error: "Could not start the session" }, { status: 500 });
  }
}
