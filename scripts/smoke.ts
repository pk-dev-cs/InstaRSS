import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const testDir = path.resolve(process.cwd(), "data", "smoke-check");
const workspaceData = path.resolve(process.cwd(), "data");
if (!testDir.startsWith(workspaceData + path.sep)) throw new Error("Nieprawidłowy katalog testowy");
await fs.rm(testDir, { recursive: true, force: true });
process.env.DATA_DIR = testDir;

const { db, images, mediaDir, posts, profiles } = await import("../lib/db");
const { generateRss } = await import("../lib/rss");
const { cleanupExpired } = await import("../lib/sync");

const profile = db.insert(profiles).values({ username: "smoke" }).returning().get();
const fresh = db.insert(posts).values({ profileId: profile.id, sourcePostId: "fresh", permalink: "https://www.instagram.com/p/fresh/", caption: "Test & zdjęcie", publishedAt: Date.now() - 1000, source: "test" }).returning().get();
db.insert(images).values({ postId: fresh.id, filename: "fresh.png", mimeType: "image/png", byteLength: 4, position: 0 }).run();
await fs.writeFile(path.join(mediaDir, "fresh.png"), Buffer.from([1, 2, 3, 4]));
const old = db.insert(posts).values({ profileId: profile.id, sourcePostId: "old", permalink: "https://www.instagram.com/p/old/", caption: "Stary", publishedAt: Date.now() - 31 * 24 * 60 * 60 * 1000, source: "test" }).returning().get();
db.insert(images).values({ postId: old.id, filename: "old.png", mimeType: "image/png", byteLength: 4, position: 0 }).run();
await fs.writeFile(path.join(mediaDir, "old.png"), Buffer.from([1, 2, 3, 4]));

const xml = generateRss("smoke", "https://example.com");
assert.ok(xml?.includes("https://example.com/media/"));
assert.ok(xml?.includes("<enclosure "));
assert.ok(xml?.includes("Test &amp; zdjęcie"));
assert.ok(!xml?.includes("Stary"));
assert.equal(await cleanupExpired(), 1);
await assert.rejects(fs.access(path.join(mediaDir, "old.png")));
await fs.access(path.join(mediaDir, "fresh.png"));
console.log("RSS, zdjęcia i retencja: OK");
