import { parseQuery, queryClauses } from "../core/query-language.js";
import { $, button, escape as e } from "./dom.js";
import { icon } from "./icons.js";

const rowButton = (label, glyph, attrs, active, count = "") =>
  `<button type="button" class="nav-item ${active ? "active" : ""}" ${attrs}>${icon(glyph)}<span>${e(label)}</span>${count === "" ? "" : `<small>${e(count)}</small>`}</button>`;

const actions = (kind, path) =>
  button(
    "nav-actions",
    kind + " actions",
    "more",
    `data-nav-kind="${kind}" data-path="${e(path)}"`,
  );
export function renderNav({
  catalog,
  data,
  where,
  folded,
  collapsed,
  sidebarOrder,
  viewId,
}) {
  $("#catalog-label").textContent = catalog?.title || "Sourcebook";
  if (!catalog || !data) {
    $("#navigation-items").replaceChildren();
    return;
  }
  const parentPaths = new Set(data.folders.map(({ parent }) => parent));
  const folders = data.folders.filter(
    ({ path }) => ![...folded].some((prefix) => path.startsWith(prefix + "/")),
  );
  const sections = {
    views: () =>
      data.views
        .map(
          ({ id, name, unavailable }) =>
            `<div class="filter-node">${rowButton(
              unavailable ? name + " · unavailable" : name,
              "eye",
              `data-nav="view" data-path="${id}"`,
              viewId === id,
            )}<span class="nav-node-actions">${actions("view", id)}</span></div>`,
        )
        .join("") || '<span class="nav-empty">No saved views</span>',
    folders: () =>
      `<div class="filter-node">${rowButton(
        "Files",
        "folder",
        'data-nav="folder" data-path=""',
        where.scope === "folder" && !where.folder,
      )}<span class="nav-node-actions">${actions("folder", "")}</span></div>` +
      folders
        .map(
          ({ path, name, depth }) => `
        <div class="source-node filter-node">
          ${rowButton(name, "folder", `style="padding-left:${8 + depth * 12}px" draggable="true" data-nav="folder" data-path="${e(path)}"`, where.scope === "folder" && where.folder === path)}
          <span class="nav-node-actions">${actions("folder", path)}
          ${parentPaths.has(path) ? button("fold", folded.has(path) ? "Expand folder" : "Collapse folder", folded.has(path) ? "forward" : "down", `data-path="${e(path)}" aria-expanded="${!folded.has(path)}"`) : ""}</span>
        </div>`,
        )
        .join(""),
    tags: () =>
      data.tags
        .map(
          ({ id, path, depth, count }) => `
      <div class="filter-node">
        ${rowButton(path.split("/").at(-1), "tag", `style="padding-left:${8 + depth * 12}px" draggable="true" data-nav="tag" data-tag-id="${e(id)}" data-path="${e(path)}"`, where.tag === path, count)}
        <span class="nav-node-actions">${actions("tag", path)}</span>
      </div>`,
        )
        .join(""),
  };
  $("#navigation-items").innerHTML = `
    <section class="nav-section">
      ${rowButton("All files", "library", 'data-nav="all"', where.scope === "all")}
      ${rowButton("Drop Inbox", "inbox", 'data-nav="inbox"', where.scope === "inbox", data.inbox.length + data.jobs.length)}
    </section>
    ${sidebarOrder
      .map((name) => {
        const label = name[0].toUpperCase() + name.slice(1);
        const open = !collapsed.has(name);
        return `<section class="nav-section"><div class="nav-section-controls">
        <button type="button" class="nav-caption" data-action="toggle-section" data-path="${name}" aria-expanded="${open}">${icon(open ? "down" : "forward")}${label}</button>
        ${button("move-section", "Move " + label + " up", "back", `data-path="${name}"`)}
        </div>${open ? sections[name]() : ""}</section>`;
      })
      .join("")}`;
}

export function renderLocation({ where, search, viewId, data }) {
  const host = $("#breadcrumbs");
  const folder = where.scope === "folder";
  const parts = folder && where.folder ? where.folder.split("/") : [];
  host.innerHTML = folder
    ? [
        '<button type="button" data-nav="folder" data-path="">Files</button>',
        ...parts.map(
          (part, i) =>
            `<button type="button" data-nav="folder" data-path="${e(parts.slice(0, i + 1).join("/"))}">${e(part)}</button>`,
        ),
      ].join("<span aria-hidden='true'>/</span>")
    : "";
  if (parts.length)
    host.insertAdjacentHTML(
      "afterbegin",
      button(
        "parent-folder",
        "Parent folder",
        "back",
        `data-path="${e(parts.slice(0, -1).join("/"))}"`,
      ),
    );
  const name = data?.views.find(({ id }) => id === viewId)?.name;
  const label = $("#view-label");
  label.hidden = folder && !name;
  label.textContent =
    name ||
    {
      all: "All files",
      inbox: "Drop Inbox",
      missing: "Needs attention",
      tag: "All files",
      folder: where.folder || "Files",
    }[where.scope];
  label.title = label.textContent;

  let clauses = [];
  try {
    clauses = queryClauses(parseQuery(search)).filter(
      ({ field }) => field === "tag" || field === "folder",
    );
  } catch {}
  $("#filter-chips").innerHTML =
    (where.scope === "tag"
      ? `<button type="button" data-action="clear-tag-location">${e(where.tag)} ${icon("close")}</button>`
      : "") +
    clauses
      .map(
        ({ field, op, value }) =>
          `<button type="button" data-action="filter-clause" data-field="${field}" data-op="${op}" data-path="${e(value)}">${e((op.startsWith("!") ? "Exclude " : "Include ") + value)} ${icon("close")}</button>`,
      )
      .join("");
}
