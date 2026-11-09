import { build } from "esbuild";
import fs from "node:fs/promises";

await fs.mkdir("dist",{recursive:true});
await build({entryPoints:{main:"src/main.ts",preload:"src/preload.ts"},outdir:"dist",outExtension:{".js":".cjs"},bundle:true,platform:"node",format:"cjs",target:"node22",external:["electron","velopack"],sourcemap:true});
