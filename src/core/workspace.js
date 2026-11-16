import { describeFile } from "./file-types.js";
export function groupRows(rows, mode, sourceName) {
  if (mode === "none") return [{ name: "", rows }];
  const groups = new Map();
  for (const row of rows) {
    const name =
      mode === "extension"
        ? describeFile(row.name).ext.toUpperCase() || "No extension"
        : mode === "type"
          ? row.type
          : mode === "status"
            ? row.available
              ? "Available"
              : "Unavailable"
            : mode === "source"
              ? sourceName(row.source)
              : `${sourceName(row.source)}${row.folder ? " / " + row.folder : ""}`;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, rows]) => ({ name, rows }));
}
