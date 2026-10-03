import { STUB_CONCEPT } from "@/app/api/stub-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  return Response.json([STUB_CONCEPT]);
}
