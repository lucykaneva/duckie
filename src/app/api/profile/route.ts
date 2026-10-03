import { getLearnerProfile } from "@/lib/db/profile";

export async function GET() {
  try {
    const profile = await getLearnerProfile();
    return Response.json(profile);
  } catch (error) {
    console.error("GET /api/profile failed", error);
    return Response.json({ error: "Could not load the profile" }, { status: 500 });
  }
}
