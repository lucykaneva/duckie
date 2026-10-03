import { listDueRecall } from "@/lib/db/sessions";

export async function GET() {
  try {
    return Response.json(await listDueRecall());
  } catch (error) {
    console.error("GET /api/review/due failed", error);
    return Response.json({ error: "Could not load due concepts" }, { status: 500 });
  }
}
