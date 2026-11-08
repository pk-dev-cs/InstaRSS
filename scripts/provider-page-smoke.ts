import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inspectProviderPage, waitForPostLinks } from "../lib/provider-page";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent('<a href="/p/example/" style="display:none">Post</a>');
  await waitForPostLinks(page, 100);
  assert.equal((await inspectProviderPage(page)).postLinks, 1);
  await page.setContent('<h1>Sign in</h1><input type="password">');
  await assert.rejects(waitForPostLinks(page, 100), /requires sign-in/);
  await page.setContent('<h1>Please wait a few minutes</h1>');
  await assert.rejects(waitForPostLinks(page, 100), /temporarily limited/);
  await page.setContent('<h1>Public profile</h1><button>Log In</button>');
  assert.equal((await inspectProviderPage(page)).requiresLogin, false);
  await assert.rejects(waitForPostLinks(page, 100), /did not return public post links/);
  console.log("Delivered hidden links, sign-in detection, limits and missing posts: OK");
} finally {
  await browser.close();
}
