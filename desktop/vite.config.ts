import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root:path.resolve(import.meta.dirname,"src/renderer"),
  base:"./",
  build:{outDir:path.resolve(import.meta.dirname,"dist/renderer"),emptyOutDir:true},
});
