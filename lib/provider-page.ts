import type { Page } from "playwright";

export const postLinkSelector = 'a[href*="/p/"], a[href*="/reel/"]';

export async function inspectProviderPage(page: Page) {
  const pathname = new URL(page.url()).pathname;
  const body = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const requiresLogin = pathname.startsWith("/accounts/login") || await page.locator('input[type="password"]').count() > 0 || /log in to (see|view|continue)|sign in to (see|view|continue)/.test(body);
  const restricted = /\/(challenge|checkpoint)\//.test(pathname);
  const limited = /please wait a few minutes|try again later|too many requests/.test(body);
  return {
    pathname,
    title: await page.title(),
    postLinks: await page.locator(postLinkSelector).count(),
    requiresLogin,
    restricted,
    limited,
    headings: (await page.locator("h1,h2").allTextContents()).map((text) => text.trim().slice(0, 120)).slice(0, 3),
  };
}

export async function waitForPostLinks(page: Page, timeout = 15000) {
  try {
    // Read links already delivered in the DOM even when a modal obscures them.
    await page.locator(postLinkSelector).first().waitFor({ state: "attached", timeout });
  } catch {
    const diagnostic = await inspectProviderPage(page);
    console.warn("Public profile unavailable", JSON.stringify(diagnostic));
    if (diagnostic.requiresLogin) throw new Error("The source requires sign-in from this server. Configure API access to fetch this profile.");
    if (diagnostic.restricted) throw new Error("The source restricted access from this server. Public fetching is unavailable.");
    if (diagnostic.limited) throw new Error("The source temporarily limited requests from this server. Try again later.");
    throw new Error("The source did not return public post links from this server. Try again later or configure API access.");
  }
}
