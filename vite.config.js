import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { appBase } from "./scripts/deployment-base.js";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
export default defineConfig({
  root: "src/web",
  base: appBase,
  build: { outDir: "../../dist", emptyOutDir: true },
  define: { __APP_VERSION__: JSON.stringify(version) },
});
