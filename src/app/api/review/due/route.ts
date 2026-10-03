import { STUB_DUE } from "@/app/api/stub-data";

export async function GET() {
  return Response.json(STUB_DUE);
}
