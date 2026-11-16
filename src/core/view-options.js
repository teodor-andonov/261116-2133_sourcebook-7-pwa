export const viewDefaults = {
  search: "",
  sort: "title",
  group: "none",
  type: "",
  availability: "",
  desc: false,
  recursive: false,
  mode: "gallery",
  size: 180,
  shape: "square",
  fit: "contain",
  properties: ["name", "tags"],
};
export const viewProperties = [
  "name",
  "tags",
  "type",
  "folder",
  "notes",
  "size",
  "modified",
  "status",
  "id",
];

export function presetKey(where, viewId) {
  if (viewId) return "view:" + viewId;
  if (where.scope === "folder") return "folder:" + where.folder;
  if (where.scope === "tag")
    return where.tagId
      ? "tag-id:" + where.tagId
      : "tag:" + where.tag.toLowerCase();
  return where.scope;
}

export function resolveViewSettings(catalog, where, viewId) {
  const presets = catalog.viewPresets ?? {};
  const defaults = {
    ...viewDefaults,
    mode: catalog.mode ?? viewDefaults.mode,
    ...catalog.viewDefault,
  };
  const key = presetKey(where, viewId);
  if (presets[key]) return { ...defaults, ...presets[key].values };
  if (viewId) return defaults;
  if (where.scope === "folder") {
    const parts = where.folder ? where.folder.split("/") : [];
    while (parts.length) {
      parts.pop();
      const parent = presets["folder:" + parts.join("/")];
      if (parent?.inherit) return { ...defaults, ...parent.values };
    }
  }
  return defaults;
}

export function thumbnailRatio(shape) {
  const amount =
    typeof shape === "number"
      ? shape
      : ({ portrait: -1, landscape: 1 }[shape] ?? 0);
  return (4 / 3) ** amount;
}
