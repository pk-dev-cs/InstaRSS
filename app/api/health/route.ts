import { sqlite } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    sqlite.prepare("SELECT 1").get();
    return Response.json({ status: "ok", application: "InstaRSS" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
