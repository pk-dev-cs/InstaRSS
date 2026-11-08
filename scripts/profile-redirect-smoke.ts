import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data");
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, "redirect-check-"));
process.env.DATA_DIR = directory;
process.env.META_ACCESS_TOKEN = "test-only";
process.env.META_IG_USER_ID = "test-only";
const { POST: add } = await import("../app/api/profiles/route");
const { POST: refresh } = await import("../app/api/profiles/[username]/sync/route");
const { sqlite } = await import("../lib/db");
const originalFetch = globalThis.fetch;
try {
  const response = await add(new Request("http://127.0.0.1:3000/api/profiles", {
    method: "POST",
    headers: { "x-forwarded-host": "example.up.railway.app", "x-forwarded-proto": "https" },
    body: new URLSearchParams({ username: "redirect_test" }),
  }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  globalThis.fetch = async () => Response.json({ business_discovery: { media: { data: [] } } });
  const updated = await refresh(new Request("http://127.0.0.1:3000/api/profiles/redirect_test/sync", { method: "POST" }), {
    params: Promise.resolve({ username: "redirect_test" }),
  });
  assert.equal(updated.status, 303);
  assert.equal(updated.headers.get("location"), "/");
  console.log("Add and refresh preserve the browser's public origin: OK");
} finally {
  globalThis.fetch = originalFetch;
  sqlite.close();
  await fs.rm(directory, { recursive: true, force: true });
}
