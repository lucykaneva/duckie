import { silenceMove } from "@/app/api/stub-data";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await params;
  const body = (await request.json().catch(() => ({}))) as { ms?: number };
  return Response.json(silenceMove(body.ms ?? 8_000));
}
