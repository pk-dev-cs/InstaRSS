import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, lt, or } from "drizzle-orm";
import { db, images, mediaDir, posts, profiles } from "./db";
import { fromApi, fromBrowser, fromPublicPage, type IncomingPost } from "./provider";

const retentionMs = 30 * 24 * 60 * 60 * 1000;
const maxImageBytes = 15 * 1024 * 1024;

export function normalizeUsername(input: string): string | null {
  const value = input.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(value) ? value : null;
}

export function addProfile(username: string) {
  const normalized = normalizeUsername(username);
  if (!normalized) throw new Error("Invalid profile username");
  db.insert(profiles).values({ username: normalized }).onConflictDoNothing().run();
  return db.select().from(profiles).where(eq(profiles.username, normalized)).get()!;
}

async function downloadImage(url: string, postId: number, position: number) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), redirect: "manual" });
  if (!response.ok) throw new Error(`Image: HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > maxImageBytes) throw new Error("Image exceeds the 15 MB limit");
  const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };
  if (!mimeType || !extensions[mimeType]) throw new Error("Unsupported image format");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxImageBytes || buffer.length === 0) throw new Error("Invalid image size");
  const filename = `${postId}-${position}.${extensions[mimeType]}`;
  await fs.writeFile(path.join(mediaDir, filename), buffer);
  return { filename, mimeType, byteLength: buffer.length, position };
}

async function savePost(profileId: number, source: string, post: IncomingPost): Promise<boolean> {
  const canonical = new URL(post.permalink).origin + new URL(post.permalink).pathname.replace(/\/?$/, "/");
  const existing = db.select({ id: posts.id }).from(posts).where(and(eq(posts.profileId, profileId), or(eq(posts.sourcePostId, post.id), eq(posts.permalink, canonical)))).get();
  if (existing) return false;
  const inserted = db.insert(posts).values({
    profileId,
    sourcePostId: post.id,
    permalink: canonical,
    caption: post.caption,
    publishedAt: post.publishedAt,
    source,
  }).returning({ id: posts.id }).get();
  try {
    const downloaded = [];
    for (const [position, url] of post.imageUrls.entries()) {
      downloaded.push(await downloadImage(url, inserted.id, position));
    }
    for (const image of downloaded) db.insert(images).values({ postId: inserted.id, ...image }).run();
    return true;
  } catch (error) {
    for (const file of await fs.readdir(mediaDir)) {
      if (file.startsWith(`${inserted.id}-`)) await fs.unlink(path.join(mediaDir, file)).catch(() => {});
    }
    db.delete(posts).where(eq(posts.id, inserted.id)).run();
    throw error;
  }
}

export async function syncProfile(profile: typeof profiles.$inferSelect) {
  let source = "api";
  let incoming: IncomingPost[];
  try {
    incoming = await fromApi(profile.username);
  } catch (apiError) {
    source = "public-page";
    try {
      incoming = await fromPublicPage(profile.username);
    } catch (scrapeError) {
      source = "browser";
      try {
        incoming = await fromBrowser(profile.username);
      } catch (browserError) {
        const error = `API: ${String(apiError)}; HTML: ${String(scrapeError)}; browser: ${String(browserError)}`;
        db.update(profiles).set({ lastCheckedAt: Date.now(), lastError: error.slice(0, 1000) }).where(eq(profiles.id, profile.id)).run();
        throw new Error(error);
      }
    }
  }
  let saved = 0;
  let failed = 0;
  for (const post of incoming) {
    if (post.publishedAt < Date.now() - retentionMs) continue;
    try {
      if (await savePost(profile.id, source, post)) saved++;
    } catch { failed++; }
  }
  db.update(profiles).set({
    lastCheckedAt: Date.now(),
    lastSuccessAt: Date.now(),
    lastSource: source,
    lastError: failed ? `Failed to save ${failed} images or posts` : null,
  }).where(eq(profiles.id, profile.id)).run();
  return { source, checked: incoming.length, saved, failed };
}

export async function cleanupExpired() {
  const expired = db.select().from(posts).where(lt(posts.publishedAt, Date.now() - retentionMs)).all();
  for (const post of expired) {
    const files = db.select().from(images).where(eq(images.postId, post.id)).all();
    for (const image of files) {
      await fs.unlink(path.join(mediaDir, image.filename)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
    db.delete(posts).where(eq(posts.id, post.id)).run();
  }
  return expired.length;
}
