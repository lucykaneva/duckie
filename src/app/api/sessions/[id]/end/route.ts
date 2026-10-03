import { STUB_WRAP_UP } from "@/app/api/stub-data";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  return Response.json(STUB_WRAP_UP);
}
