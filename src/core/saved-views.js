import { Problem, relativeParts } from "../local/files.js";
import { parseQuery } from "./query-language.js";

import { presetKey, viewDefaults, viewProperties } from "./view-options.js";
const choices = {
  sort: ["title", "modified", "type", "size"],
  group: ["none", "type", "extension", "folder", "status"],
  type: [
    "",
    "image",
    "pdf",
    "audio",
    "video",
    "text",
    "code",
    "archive",
    "file",
    "link",
    "html",
  ],
  availability: ["", "available", "unavailable"],
  mode: ["gallery", "list", "table"],
  fit: ["contain", "cover"],
};
const boolean = ["desc", "recursive"];
const invalid = () => new Problem(400, "Invalid saved view settings.");

export function validateViewSettings(input) {
  const result = { ...viewDefaults };
  for (const [key, values] of Object.entries(choices)) {
    if (input[key] === undefined) continue;
    if (!values.includes(input[key])) throw invalid();
    result[key] = input[key];
  }
  for (const key of boolean) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== "boolean") throw invalid();
    result[key] = input[key];
  }
  if (input.shape !== undefined) {
    if (
      !["square", "portrait", "landscape"].includes(input.shape) &&
      (typeof input.shape !== "number" ||
        !Number.isFinite(input.shape) ||
        Math.abs(input.shape) > 1)
    )
      throw invalid();
    result.shape = input.shape;
  }
  if (input.size !== undefined) {
    if (!Number.isInteger(input.size) || input.size < 80 || input.size > 300)
      throw invalid();
    result.size = input.size;
  }
  if (input.properties !== undefined) {
    if (
      !Array.isArray(input.properties) ||
      input.properties.length > viewProperties.length ||
      !input.properties.every((key) => viewProperties.includes(key))
    )
      throw invalid();
    result.properties = [...new Set(input.properties)];
  }
  if (input.search !== undefined) {
    if (typeof input.search !== "string" || input.search.length > 1024)
      throw invalid();
    try {
      parseQuery(input.search);
    } catch (error) {
      throw new Problem(400, error.message);
    }
    result.search = input.search;
  }
  return result;
}

function location(input) {
  switch (input?.scope) {
    case "all":
    case "missing":
      return { scope: input.scope };
    case "folder":
      relativeParts(input.folder);
      return { scope: "folder", folder: input.folder };
    case "tag":
      if (typeof input.tag !== "string" || !input.tag || input.tag.length > 240)
        throw invalid();
      return { scope: "tag", tag: input.tag };
    default:
      throw invalid();
  }
}

export function writeView(store, id, input, { remove = false } = {}) {
  const current = store.settings();
  const views = current.views ?? [];
  const index = id ? views.findIndex((view) => view.id === id) : -1;
  if (id && index < 0) throw new Problem(404, "Saved view not found.");
  if (remove) {
    views.splice(index, 1);
    const viewPresets = { ...current.viewPresets };
    delete viewPresets[presetKey(null, id)];
    store.saveSettings({ ...current, views, viewPresets });
    return;
  }
  const name = typeof input?.name === "string" && input.name.trim();
  if (!name || name.length > 80 || /[\x00-\x1f]/.test(name))
    throw new Problem(400, "Enter a view name of up to 80 characters.");
  if (
    views.some(
      (view) =>
        view.id !== id && view.name.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Problem(409, "A saved view already has that name.");
  if (index < 0 && views.length >= 200)
    throw new Problem(400, "This catalog has reached the saved view limit.");
  const view =
    input.nameOnly === true && index >= 0
      ? { ...views[index], name }
      : {
          id: id ?? crypto.randomUUID(),
          name,
          where: location(input.where),
          ...validateViewSettings(input),
        };
  if (input.repairLocation === true && index >= 0) {
    store.directory(view.where.folder);
  }
  const { id: viewId, where, unavailable } = view;
  const entry = {
    id: viewId,
    name,
    where,
    ...(unavailable ? { unavailable } : {}),
  };
  if (index < 0) views.push(entry);
  else views[index] = entry;
  const viewPresets = { ...current.viewPresets };
  const key = presetKey(null, view.id);
  if (index < 0 || (input.nameOnly !== true && input.repairLocation !== true))
    viewPresets[key] = { inherit: false, values: validateViewSettings(input) };
  store.saveSettings({ ...current, views, viewPresets });
  return { ...viewPresets[key]?.values, ...entry };
}

export function writePreset(store, input) {
  const current = store.settings();
  const { target, mode, values } = input ?? {};
  if (mode === "default") {
    store.saveSettings({
      ...current,
      viewDefault: validateViewSettings(values ?? {}),
    });
    return store.settings();
  }
  if (!["none", "local", "tree"].includes(mode)) throw invalid();
  const where =
    target?.scope === "inbox" ? { scope: "inbox" } : location(target);
  const view = target.viewId;
  if (view && !current.views?.some(({ id }) => id === view)) throw invalid();
  if (mode === "tree" && (view || where.scope !== "folder")) throw invalid();
  if (where.scope === "tag") {
    where.tagId = store.tagId(where.tag);
    if (!where.tagId && !view) throw invalid();
  }
  const key = presetKey(where, view);
  const viewPresets = { ...current.viewPresets };
  if (mode === "none") delete viewPresets[key];
  else
    viewPresets[key] = {
      inherit: mode === "tree",
      values: validateViewSettings(values ?? {}),
    };
  store.saveSettings({ ...current, viewPresets });
  return store.settings();
}
