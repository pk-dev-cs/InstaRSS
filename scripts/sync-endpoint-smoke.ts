import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve("data");
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, "sync-endpoint-"));
process.env.DATA_DIR = directory;
const { POST } = await import("../app/api/sync/route");
const { sqlite } = await import("../lib/db");
const request = (token?: string) => new Request("http://localhost/api/sync", {
  method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {},
});
try {
  delete process.env.SYNC_TOKEN;
  assert.equal((await POST(request())).status, 503);
  process.env.SYNC_TOKEN = "test-secret";
  assert.equal((await POST(request())).status, 401);
  assert.equal((await POST(request("wrong-secret"))).status, 401);
  const response = await POST(request("test-secret"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, removed: 0, results: [] });
  sqlite.prepare("INSERT INTO sync_lock (id, expires_at) VALUES (1, ?)").run(Date.now() + 60000);
  assert.equal((await POST(request("test-secret"))).status, 409);
  sqlite.prepare("UPDATE sync_lock SET expires_at = 0").run();
  assert.equal((await POST(request("test-secret"))).status, 200);
  console.log("Sync endpoint: authentication, execution, overlap protection and expired lease recovery OK");
} finally {
  sqlite.close();
  await fs.rm(directory, { recursive: true, force: true });
}
