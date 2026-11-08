import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.resolve("data");
await fs.mkdir(root, { recursive: true });
const directory = await fs.mkdtemp(path.join(root, "concurrent-db-"));
try {
  await Promise.all(Array.from({ length: 8 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", "await import('./lib/db.ts')"], {
      env: { ...process.env, DATA_DIR: directory }, stdio: ["ignore", "ignore", "pipe"],
    });
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => {
      try { assert.equal(code, 0, error); resolve(); } catch (failure) { reject(failure); }
    });
  })));
  console.log("Eight concurrent SQLite initializations: OK");
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
