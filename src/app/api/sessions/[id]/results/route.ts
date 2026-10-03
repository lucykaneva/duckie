import { STUB_RESULTS } from "@/app/api/stub-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return Response.json({ ...STUB_RESULTS, sessionId: id });
}
