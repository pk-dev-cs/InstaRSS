import * as cheerio from "cheerio";

export type IncomingPost = {
  id: string;
  permalink: string;
  caption: string;
  publishedAt: number;
  imageUrls: string[];
};

const userAgent = "Mozilla/5.0 (compatible; InstaRSS/1.0; +https://example.invalid)";
const timeoutMs = 15000;

function cutoff() {
  return Date.now() - 30 * 24 * 60 * 60 * 1000;
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (host === "instagram.com" || host.endsWith(".instagram.com") || host === "cdninstagram.com" || host.endsWith(".cdninstagram.com") || host === "fbcdn.net" || host.endsWith(".fbcdn.net")) return url.href;
  } catch { /* invalid URL */ }
  return null;
}

function htmlText($: cheerio.CheerioAPI, selector: string): string {
  return $(selector).first().attr("content")?.trim() || "";
}

function jsonLdPost($: cheerio.CheerioAPI): { datePublished?: string; caption?: string; image?: string } {
  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed: unknown = JSON.parse($(element).text());
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const value = entry as Record<string, unknown>;
        const image = typeof value.image === "string" ? value.image : Array.isArray(value.image) ? value.image[0] : undefined;
        return {
          datePublished: typeof value.datePublished === "string" ? value.datePublished : undefined,
          caption: typeof value.caption === "string" ? value.caption : typeof value.description === "string" ? value.description : undefined,
          image: typeof image === "string" ? image : undefined,
        };
      }
    } catch { /* A malformed JSON-LD block is ignored. */ }
  }
  return {};
}

export async function fromApi(username: string): Promise<IncomingPost[]> {
  const token = process.env.META_ACCESS_TOKEN;
  const igUserId = process.env.META_IG_USER_ID;
  if (!token || !igUserId) throw new Error("Meta API is not configured");
  const version = process.env.META_GRAPH_VERSION || "v24.0";
  const fields = `business_discovery.username(${username}){media.limit(30){id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,children{media_type,media_url,thumbnail_url}}}`;
  const url = new URL(`https://graph.facebook.com/${version}/${encodeURIComponent(igUserId)}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(body.error?.message || `Meta API: HTTP ${response.status}`);
  const media = body.business_discovery?.media?.data;
  if (!Array.isArray(media)) throw new Error("Meta API did not return a post list");
  return media.flatMap((item: Record<string, any>) => {
    const publishedAt = Date.parse(item.timestamp);
    if (!Number.isFinite(publishedAt) || publishedAt < cutoff()) return [];
    const children = Array.isArray(item.children?.data) ? item.children.data : [];
    const rawUrls = children.length ? children.map((child: Record<string, unknown>) => child.media_type === "IMAGE" ? child.media_url : child.thumbnail_url) : [item.media_type === "IMAGE" ? item.media_url : item.thumbnail_url];
    const imageUrls = rawUrls.map(imageUrl).filter((value: string | null): value is string => !!value);
    if (!item.permalink || !item.id || imageUrls.length === 0) return [];
    return [{ id: String(item.id), permalink: String(item.permalink), caption: String(item.caption || ""), publishedAt, imageUrls }];
  });
}

async function getHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "user-agent": userAgent, "accept-language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Photo provider: HTTP ${response.status}`);
  return response.text();
}

async function scrapePost(url: string): Promise<IncomingPost | null> {
  const html = await getHtml(url);
  const $ = cheerio.load(html);
  const structured = jsonLdPost($);
  const image = imageUrl(htmlText($, 'meta[property="og:image"]') || structured.image);
  const published = htmlText($, 'meta[property="article:published_time"]') || $("time[datetime]").first().attr("datetime") || structured.datePublished || "";
  const publishedAt = Date.parse(published);
  if (!image || !Number.isFinite(publishedAt) || publishedAt < cutoff()) return null;
  const parsed = new URL(url);
  const match = parsed.pathname.match(/^\/(?:[^/]+\/)?(p|reel)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const permalink = `https://www.instagram.com/${match[1]}/${match[2]}/`;
  const caption = structured.caption || htmlText($, 'meta[property="og:description"]') || htmlText($, 'meta[name="description"]');
  return { id: match[2], permalink, caption, publishedAt, imageUrls: [image] };
}

export async function fromPublicPage(username: string): Promise<IncomingPost[]> {
  const html = (await getHtml(`https://www.instagram.com/${username}/`))
    .replaceAll("\\/", "/").replaceAll("\\u002F", "/").replaceAll("\\u002f", "/");
  const matches = [...html.matchAll(/\/(?:p|reel)\/([A-Za-z0-9_-]+)\/?/g)];
  const paths = [...new Set(matches.map((match) => match[0]))].slice(0, 30);
  if (paths.length === 0) throw new Error("The public page does not provide a post list without signing in");
  const results: IncomingPost[] = [];
  for (const postPath of paths) {
    try {
      const post = await scrapePost(`https://www.instagram.com${postPath}`);
      if (post) results.push(post);
    } catch { /* An individual post may be unavailable. */ }
  }
  if (results.length === 0) throw new Error("Could not read posts and photos from the public page");
  return results;
}

export async function fromBrowser(username: string): Promise<IncomingPost[]> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ locale: "en-US" });
    const response = await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
    if (!response?.ok()) throw new Error(`Photo provider: HTTP ${response?.status() || "no response"}`);
    await page.locator('a[href*="/p/"], a[href*="/reel/"]').first().waitFor({ timeout: 10000 });
    const links = await page.locator('a[href*="/p/"], a[href*="/reel/"]').evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href));
    const paths = [...new Set(links)].filter((value) => {
      try {
        const parsed = new URL(value);
        const segments = parsed.pathname.split("/").filter(Boolean);
        const index = segments[0]?.toLowerCase() === username ? 1 : 0;
        return parsed.hostname === "www.instagram.com" && (segments[index] === "p" || segments[index] === "reel") && /^[A-Za-z0-9_-]+$/.test(segments[index + 1] || "");
      } catch { return false; }
    }).slice(0, 30);
    if (paths.length === 0) throw new Error("The browser did not display posts from the public profile");
    const postPage = await browser.newPage({ locale: "en-US" });
    const results: IncomingPost[] = [];
    for (const link of paths) {
      try {
        await postPage.goto(link, { waitUntil: "domcontentloaded", timeout: 20000 });
        await postPage.locator("time[datetime]").first().waitFor({ timeout: 7000 });
        const publishedAt = Date.parse((await postPage.locator("time[datetime]").first().getAttribute("datetime")) || "");
        const image = imageUrl(await postPage.locator('meta[property="og:image"]').getAttribute("content"));
        if (!Number.isFinite(publishedAt) || publishedAt < cutoff() || !image) continue;
        const pathMatch = new URL(link).pathname.match(/^\/(?:[^/]+\/)?(p|reel)\/([A-Za-z0-9_-]+)/);
        if (!pathMatch) continue;
        const caption = (await postPage.locator('meta[property="og:description"]').getAttribute("content")) || "";
        results.push({ id: pathMatch[2], permalink: `https://www.instagram.com/${pathMatch[1]}/${pathMatch[2]}/`, caption, publishedAt, imageUrls: [image] });
      } catch { /* One unavailable post does not discard the feed. */ }
    }
    if (results.length === 0) throw new Error("The browser did not return posts with photos and publication dates");
    return results;
  } finally {
    await browser.close();
  }
}
