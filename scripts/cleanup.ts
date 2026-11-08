import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { cleanupExpired } = await import("../lib/sync");

console.log(`Usunięto ${await cleanupExpired()} przeterminowanych postów`);
