import { timingSafeEqual } from "node:crypto";
import { syncAll, SyncInProgressError } from "@/lib/sync-all";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.SYNC_TOKEN;
  if (!secret) return Response.json({ error: "Synchronization endpoint is not configured" }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await syncAll();
    const failed = result.results.some((profile) => "error" in profile || ("failed" in profile && profile.failed > 0));
    return Response.json({ ok: !failed, ...result }, { status: failed ? 502 : 200 });
  } catch (error) {
    if (error instanceof SyncInProgressError) return Response.json({ error: error.message }, { status: 409 });
    console.error("Synchronization failed", error);
    return Response.json({ error: "Synchronization failed" }, { status: 500 });
  }
}
