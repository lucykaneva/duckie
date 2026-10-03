import { STUB_CONCEPT } from "@/app/api/stub-data";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json(
    { status: "processing" as const, sectionId: id },
    { status: 202 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json({
    status: "ready" as const,
    sectionId: id,
    concepts: [STUB_CONCEPT],
  });
}
