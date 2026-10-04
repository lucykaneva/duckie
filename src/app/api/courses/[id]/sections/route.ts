import { courseExists, createSection, listSections } from "@/lib/db/courses";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: courseId } = await params;
  try {
    if (!(await courseExists(courseId))) {
      return Response.json({ error: "That course doesn't exist." }, { status: 404 });
    }
    return Response.json(await listSections(courseId));
  } catch (error) {
    console.error("GET /api/courses/[id]/sections failed", error);
    return Response.json({ error: "Could not load sections" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: courseId } = await params;
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    type?: unknown;
  } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const type = body?.type === "project" ? "project" : body?.type === "test" ? "test" : null;

  if (!name || !type) {
    return Response.json({ error: "name and type (test or project) are required" }, { status: 400 });
  }

  try {
    const section = await createSection(courseId, name, type);
    if (!section) {
      return Response.json({ error: "That course doesn't exist." }, { status: 404 });
    }
    return Response.json(section, { status: 201 });
  } catch (error) {
    console.error("POST /api/courses/[id]/sections failed", error);
    return Response.json({ error: "Could not create the section" }, { status: 500 });
  }
}
