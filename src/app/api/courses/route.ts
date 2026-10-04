import { createCourse, listCourses } from "@/lib/db/courses";

export async function GET() {
  try {
    return Response.json(await listCourses());
  } catch (error) {
    console.error("GET /api/courses failed", error);
    return Response.json({ error: "Could not load courses" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "Give the course a name." }, { status: 400 });
  }

  try {
    const course = await createCourse(name);
    return Response.json(course, { status: 201 });
  } catch (error) {
    console.error("POST /api/courses failed", error);
    return Response.json({ error: "Could not create the course" }, { status: 500 });
  }
}
