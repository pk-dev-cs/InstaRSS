import { eq, desc } from "drizzle-orm";
import { db, images, posts, profiles } from "./db";

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function cdata(value: string): string {
  return `<![CDATA[${value.replaceAll("]]>", "]] >")}]]>`;
}

export function generateRss(username: string, baseUrl: string): string | null {
  const profile = db.select().from(profiles).where(eq(profiles.username, username)).get();
  if (!profile) return null;
  const recent = db.select().from(posts).where(eq(posts.profileId, profile.id)).orderBy(desc(posts.publishedAt)).all()
    .filter((post) => post.publishedAt >= Date.now() - 30 * 24 * 60 * 60 * 1000);
  const items = recent.map((post) => {
    const media = db.select().from(images).where(eq(images.postId, post.id)).all().sort((a, b) => a.position - b.position);
    const first = media[0];
    if (!first) return "";
    const mediaUrl = `${baseUrl}/media/${first.id}`;
    const body = `<p>${escapeXml(post.caption).replaceAll("\n", "<br>")}</p>` +
      media.map((image) => `<p><img src="${escapeXml(`${baseUrl}/media/${image.id}`)}" alt="Photo from a shared post"></p>`).join("");
    return `<item><title>${escapeXml(post.caption.slice(0, 100) || `Post @${username}`)}</title>` +
      `<link>${escapeXml(post.permalink)}</link>` +
      `<guid isPermaLink="false">instarss:${escapeXml(username)}:${escapeXml(post.sourcePostId)}</guid>` +
      `<pubDate>${new Date(post.publishedAt).toUTCString()}</pubDate>` +
      `<description>${cdata(body)}</description>` +
      `<enclosure url="${escapeXml(mediaUrl)}" length="${first.byteLength}" type="${escapeXml(first.mimeType)}"/>` +
      media.map((image) => `<media:content url="${escapeXml(`${baseUrl}/media/${image.id}`)}" type="${escapeXml(image.mimeType)}" medium="image" fileSize="${image.byteLength}"/>`).join("") +
      `</item>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>` +
    `<title>InstaRSS @${escapeXml(username)}</title><link>https://www.instagram.com/${escapeXml(username)}/</link>` +
    `<description>Posts from @${escapeXml(username)} published in the last 30 days</description>` +
    `<language>en</language><lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}</channel></rss>`;
}
