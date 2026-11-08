import { db, profiles, sqlite } from "./db";
import { cleanupExpired, syncProfile } from "./sync";

export class SyncInProgressError extends Error {
  constructor() { super("Synchronization is already running"); }
}

export async function syncAll() {
  sqlite.exec("CREATE TABLE IF NOT EXISTS sync_lock (id INTEGER PRIMARY KEY, expires_at INTEGER NOT NULL)");
  const leaseMs = 5 * 60 * 1000;
  const acquired = sqlite.prepare("INSERT INTO sync_lock (id, expires_at) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET expires_at = excluded.expires_at WHERE sync_lock.expires_at < ?")
    .run(Date.now() + leaseMs, Date.now());
  if (!acquired.changes) throw new SyncInProgressError();
  const heartbeat = setInterval(() => {
    sqlite.prepare("UPDATE sync_lock SET expires_at = ? WHERE id = 1").run(Date.now() + leaseMs);
  }, 30000);
  try {
    const removed = await cleanupExpired();
    const results = [];
    for (const profile of db.select().from(profiles).all()) {
      try {
        results.push({ username: profile.username, ...await syncProfile(profile) });
      } catch (error) {
        results.push({ username: profile.username, error: String(error) });
      }
    }
    return { removed, results };
  } finally {
    clearInterval(heartbeat);
    sqlite.prepare("DELETE FROM sync_lock WHERE id = 1").run();
  }
}
