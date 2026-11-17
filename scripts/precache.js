import { createHash } from "node:crypto";
import { cp, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appBase } from "./deployment-base.js";

const manifestPath = "dist/sourcebook.webmanifest";
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
manifest.id = appBase;
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(
    join("node_modules", "pdfjs-dist", folder),
    join("dist", "pdf", folder),
    { recursive: true },
  );

const entries = (
  await readdir("dist", { recursive: true, withFileTypes: true })
)
  .filter(
    (entry) =>
      entry.isFile() &&
      !["precache.js", "sourcebook-worker.js"].includes(entry.name),
  )
  .map((entry) =>
    join(entry.parentPath, entry.name).slice(5).replaceAll("\\", "/"),
  )
  .sort();
const hash = createHash("sha256").update(
  await readFile("dist/sourcebook-worker.js"),
);
for (const entry of entries)
  hash.update(entry).update(await readFile(join("dist", entry)));
await writeFile(
  "dist/precache.js",
  [
    "export const version = " +
      JSON.stringify(hash.digest("hex").slice(0, 16)) +
      ";",
    "export const assets = " + JSON.stringify(entries) + ";",
  ].join("\n"),
);
