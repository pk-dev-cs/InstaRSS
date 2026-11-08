import { generateRss } from "@/lib/rss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ feed: string }> }) {
  const { feed } = await context.params;
  if (!feed.endsWith(".xml")) return new Response("Feed not found", { status: 404 });
  const username = feed.slice(0, -4);
  const baseUrl = process.env.APP_BASE_URL || new URL(request.url).origin;
  const rss = generateRss(username, baseUrl.replace(/\/$/, ""));
  if (!rss) return new Response("Feed not found", { status: 404 });
  return new Response(rss, { headers: { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=300" } });
}
