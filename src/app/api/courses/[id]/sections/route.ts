import { STUB_SECTION } from "@/app/api/stub-data";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    type?: "test" | "project";
  };
  return Response.json(
    {
      ...STUB_SECTION,
      id: "sec_new",
      courseId: id,
      name: body.name ?? STUB_SECTION.name,
      type: body.type === "project" ? "project" : "test",
    },
    { status: 201 },
  );
}
