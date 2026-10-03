import { STUB_OPENING_MOVE } from "@/app/api/stub-data";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    sectionId?: string;
    topic?: string;
    confidence?: number;
  };
  return Response.json(
    {
      sessionId: "s_88",
      sectionId: body.sectionId ?? "sec_1",
      topic: body.topic ?? "Binary search",
      confidence: body.confidence ?? 5,
      move: STUB_OPENING_MOVE,
    },
    { status: 201 },
  );
}
