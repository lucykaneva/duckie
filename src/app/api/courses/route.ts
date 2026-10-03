import { STUB_COURSE } from "@/app/api/stub-data";

export async function GET() {
  return Response.json([STUB_COURSE]);
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { name?: string };
  return Response.json(
    {
      ...STUB_COURSE,
      id: "course_new",
      name: body.name ?? "Untitled course",
    },
    { status: 201 },
  );
}
