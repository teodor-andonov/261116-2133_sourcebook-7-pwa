import { parseQuery, matchQuery } from "./query-language.js";
export function normalizeTags(tags) {
  const seen = new Set();
  return tags
    .map((t) =>
      t
        .trim()
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean)
        .join("/"),
    )
    .filter((t) => {
      if (!t || seen.has(t.toLowerCase())) return false;
      if (t.length > 240 || /[\x00-\x1f]/.test(t))
        throw Error("Tag path is too long or contains control characters.");
      seen.add(t.toLowerCase());
      return true;
    });
}
export const inTag = (tag, branch) =>
  tag.toLowerCase() === branch.toLowerCase() ||
  tag.toLowerCase().startsWith(`${branch.toLowerCase()}/`);
export function tagTree(objects) {
  const tags = new Map();
  for (const obj of objects)
    for (const tag of obj.tags || []) {
      const segments = tag.split("/");
      for (let i = 1; i <= segments.length; i++) {
        const path = segments.slice(0, i).join("/");
        if (!tags.has(path.toLowerCase()))
          tags.set(path.toLowerCase(), {
            path,
            depth: i - 1,
            count: new Set(),
          });
        tags.get(path.toLowerCase()).count.add(obj.id);
      }
    }
  return [...tags.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((t) => ({ ...t, count: t.count.size }));
}
const naturalOrder = new Intl.Collator(undefined, { numeric: true });
export function queryRows(rows, q = {}) {
  const expression = parseQuery(q.search || "");
  const result = rows.filter((r) => {
    if (q.scope === "unavailable" && (!r.object || r.available || r.stale))
      return false;
    if (q.scope === "clashes" && !r.clash) return false;
    if (q.dotfiles === false && r.name.startsWith(".")) return false;
    if (!q.expressionMode) {
      if (q.membership === "cataloged" && !r.object) return false;
      if (q.membership === "uncataloged" && r.object) return false;
      if (q.source && r.source !== q.source) return false;
      if (
        q.folder !== undefined &&
        r.folder !== q.folder &&
        !(q.recursive && (!q.folder || r.folder?.startsWith(q.folder + "/")))
      )
        return false;
      if (q.tags?.length) {
        const matches = q.tags.map((branch) =>
          r.tags?.some((t) => inTag(t, branch)),
        );
        if (
          q.tagMode === "any" ? !matches.some(Boolean) : !matches.every(Boolean)
        )
          return false;
      }
      if (q.tag && !r.tags?.some((t) => inTag(t, q.tag))) return false;
      if (q.type && r.type !== q.type) return false;
      if (q.availability === "available" && (!r.available || r.stale))
        return false;
      if (q.availability === "unavailable" && (r.available || r.stale))
        return false;
    }
    return matchQuery(r, expression);
  });
  const field = q.sort || "title";
  return result.sort(
    (a, b) =>
      (field === "modified"
        ? (typeof a.modified === "number"
            ? a.modified
            : Date.parse(a.modified) || 0) -
          (typeof b.modified === "number"
            ? b.modified
            : Date.parse(b.modified) || 0)
        : field === "size"
          ? (a.size || 0) - (b.size || 0)
          : typeof a[field] === "number"
            ? a[field] - b[field]
            : naturalOrder.compare(
                String(a[field] || ""),
                String(b[field] || ""),
              )) * (q.desc ? -1 : 1),
  );
}
