import fs from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, images, mediaDir, posts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!/^\d+$/.test(id)) return new Response("Not found", { status: 404 });
  const image = db.select().from(images).where(eq(images.id, Number(id))).get();
  if (!image) return new Response("Not found", { status: 404 });
  const post = db.select().from(posts).where(eq(posts.id, image.postId)).get();
  if (!post || post.publishedAt < Date.now() - 30 * 24 * 60 * 60 * 1000) return new Response("Not found", { status: 404 });
  try {
    const buffer = await fs.readFile(path.join(mediaDir, image.filename));
    return new Response(new Uint8Array(buffer), { headers: { "content-type": image.mimeType, "content-length": String(buffer.length), "cache-control": "public, max-age=3600" } });
  } catch { return new Response("Not found", { status: 404 }); }
}
