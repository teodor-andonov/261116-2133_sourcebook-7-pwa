import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const paths = ["package.json", "package-lock.json"];
try {
  const staged = paths.map((path) => git("show", `:${path}`));
  if (
    paths.some(
      (path, i) =>
        readFileSync(path, "utf8").replaceAll("\r\n", "\n") !==
        staged[i].replaceAll("\r\n", "\n"),
    )
  )
    throw Error(
      "Stage or restore package.json and package-lock.json before committing so versioning does not include unrelated edits.",
    );
  const pkg = JSON.parse(staged[0]);
  const lock = JSON.parse(staged[1]);
  let hasHead = true;
  try {
    git("rev-parse", "--verify", "--quiet", "HEAD");
  } catch (error) {
    if (error.status !== 1) throw error;
    hasHead = false;
  }
  const previous = hasHead
    ? JSON.parse(git("show", "HEAD:package.json")).version
    : null;
  if (pkg.version === previous) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(previous);
    if (!match)
      throw Error("Expected a stable semantic version in package.json.");
    pkg.version = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  }
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version))
    throw Error("Expected a stable semantic version.");
  lock.version = pkg.version;
  lock.packages[""].version = pkg.version;
  writeFileSync(paths[0], JSON.stringify(pkg, null, 2) + "\n");
  writeFileSync(paths[1], JSON.stringify(lock, null, 2) + "\n");
  git("add", "--", ...paths);
  console.log(`Commit version: v${pkg.version}`);
} catch (error) {
  console.error(`Version update failed: ${error.message}`);
  process.exitCode = 1;
}
