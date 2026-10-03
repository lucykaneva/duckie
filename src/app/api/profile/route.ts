import { STUB_PROFILE } from "@/app/api/stub-data";

export async function GET() {
  return Response.json(STUB_PROFILE);
}
