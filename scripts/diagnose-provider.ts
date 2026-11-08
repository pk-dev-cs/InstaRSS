import { chromium } from "playwright";
import { inspectProviderPage, waitForPostLinks } from "../lib/provider-page";

const username = process.argv[2];
if (!username || !/^[a-zA-Z0-9._]{1,30}$/.test(username)) throw new Error("Provide a public profile username");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ locale: "en-US" });
  const failures: string[] = [];
  page.on("requestfailed", (request) => {
    if (failures.length < 5) failures.push(`${new URL(request.url()).hostname}: ${request.failure()?.errorText}`);
  });
  const response = await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  try { await waitForPostLinks(page); } catch { /* Diagnostics are reported below. */ }
  console.log("Provider diagnostic", JSON.stringify({ status: response?.status(), ...await inspectProviderPage(page), failures }));
} catch (error) {
  console.error("Provider diagnostic failed", error instanceof Error ? error.message.split("\n")[0] : "Unknown error");
} finally {
  await browser.close();
}
