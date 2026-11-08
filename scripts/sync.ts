import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { syncAll } = await import("../lib/sync-all");
try {
  const result = await syncAll();
  console.log(JSON.stringify(result, null, 2));
  if (result.results.some((profile) => "error" in profile || ("failed" in profile && profile.failed > 0))) process.exitCode = 1;
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
}
