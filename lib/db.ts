import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  lastCheckedAt: integer("last_checked_at"),
  lastSuccessAt: integer("last_success_at"),
  lastSource: text("last_source"),
  lastError: text("last_error"),
});

export const posts = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  profileId: integer("profile_id").notNull().references(() => profiles.id, { onDelete: "cascade" }),
  sourcePostId: text("source_post_id").notNull(),
  permalink: text("permalink").notNull(),
  caption: text("caption").notNull().default(""),
  publishedAt: integer("published_at").notNull(),
  source: text("source").notNull(),
}, (table) => [uniqueIndex("posts_profile_source_post_id").on(table.profileId, table.sourcePostId)]);

export const images = sqliteTable("images", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  postId: integer("post_id").notNull().references(() => posts.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  byteLength: integer("byte_length").notNull(),
  position: integer("position").notNull(),
});

const dataDir = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(dataDir, { recursive: true });
export const mediaDir = path.join(dataDir, "media");
fs.mkdirSync(mediaDir, { recursive: true });

const sqlite = new Database(path.join(dataDir, "feed.sqlite"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");
sqlite.exec(`
CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  last_checked_at INTEGER,
  last_success_at INTEGER,
  last_source TEXT,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source_post_id TEXT NOT NULL,
  permalink TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  published_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  UNIQUE (profile_id, source_post_id)
);
CREATE INDEX IF NOT EXISTS posts_profile_published ON posts(profile_id, published_at DESC);
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS images_post ON images(post_id);
`);

// Upgrade the legacy column without losing posts or image relationships.
const postColumns = sqlite.pragma("table_info(posts)") as { name: string }[];
if (postColumns.some((column) => column.name === "instagram_id")) {
  sqlite.exec("ALTER TABLE posts RENAME COLUMN instagram_id TO source_post_id");
}

export const db = drizzle(sqlite, { schema: { profiles, posts, images } });
export { sqlite };
