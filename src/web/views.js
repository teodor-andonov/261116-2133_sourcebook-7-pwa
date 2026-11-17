import { thumbnailRatio } from "../core/view-options.js";
import { $, button, escape as e, field } from "./dom.js";
import { formatBytes, formatDate } from "./format.js";
import { icon } from "./icons.js";

export { renderNav } from "./navigation.js";
import { renderLocation } from "./navigation.js";
import { reconcileResults } from "./result-dom.js";
import { resultWindow } from "./result-window.js";
import { syncThumbnails } from "./media-cache.js";

const propertyLabels = {
  name: "Name",
  tags: "Tags",
  type: "Type",
  folder: "Folder",
  notes: "Notes",
  size: "Size",
  modified: "Modified",
  status: "Status",
  id: "ID",
};

function fileItem(row, state, resource) {
  const link = row.link;
  const remoteCover = link?.cover && navigator.onLine;
  const localThumb = row.preview && (!link || link.hasCover);
  const identity = link
    ? `<span class="link-identity">${icon("link")}${link.favicon && navigator.onLine ? `<img class="link-favicon" src="${e(link.favicon)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span>${e(link.domain)}</span></span>`
    : "";
  const thumb = `<span class="thumbnail ${row.preview ? "has-preview" : ""}" >
    ${!link && state.catalog?.fileBadge !== false ? `<span class="file-type-badge" aria-hidden="true">${icon(row.icon)}${e(row.extension?.toUpperCase() || "")}</span>` : ""}
    ${localThumb ? `<img loading="lazy" decoding="async" alt="" data-thumbnail="${resource(row.id)}/thumbnail?v=${e(row.previewVersion)}&r=${e(row.previewToken || "")}">` : ""}
    ${remoteCover ? `<img class="link-cover" src="${e(link.cover)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}
    ${identity}
    ${row.previewStatus === "pending" ? '<span class="preview-progress">Preparing preview…</span>' : ""}
    ${!row.available ? `<span class="availability" title="Original missing">${icon("alert")}</span>` : ""}
  </span>`;
  const active = state.selectedIds.has(row.id);
  const values = {
    name: row.title,
    tags: row.tags.join(" · "),
    type: row.extension?.toUpperCase() || row.type,
    folder: row.folder || "Files",
    notes: row.notes,
    size: formatBytes(row.size),
    modified: formatDate(row.modified),
    status: row.available ? "Available" : "Missing",
    id: row.id,
  };
  return `<div class="file-entry" data-id="${e(row.id)}"><button type="button" class="file-item ${active ? "selected" : ""}" data-id="${e(row.id)}" aria-label="${e(row.title)}" aria-pressed="${active}" draggable="true">${thumb}
      <span class="file-caption">${state.properties.map((property) => `<span class="${property === "name" ? "file-title" : "file-subtitle"}" title="${e(values[property])}">${e(values[property])}</span>`).join("")}</span>
    </button><input class="selection-check" type="checkbox" data-select-id="${e(row.id)}" aria-label="Select ${e(row.title)}" ${active ? "checked" : ""}></div>`;
}

function inbox(data, { search, sort, desc }) {
  const phrase = search.trim().toLowerCase();
  const matches = (value) => value.toLowerCase().includes(phrase);
  const compare = (a, b) =>
    (desc ? -1 : 1) *
    ((sort === "size" ? (a.size ?? 0) - (b.size ?? 0) : 0) ||
      a.name.localeCompare(b.name));
  const files = data.inbox.filter(({ name }) => matches(name)).sort(compare);
  const jobs = data.jobs.filter(({ name }) => matches(name)).sort(compare);
  if (!files.length && !jobs.length)
    return `<div class="empty-small">${icon("inbox")}<p>${phrase ? "No matching intake items." : "Inbox is empty."}</p></div>`;

  return `<div class="intake-list">
    ${data.jobs.some(({ phase }) => phase !== "cleanup") ? '<button type="button" data-action="cancel-all">Cancel all</button>' : ""}
    ${files
      .map(
        ({ name, size }) => `
      <div class="intake-item">${icon("file")}<span>${e(name)}<small>${formatBytes(size)}</small></span>
        <button type="button" data-action="process" data-name="${e(name)}">Process</button></div>`,
      )
      .join("")}
    ${jobs
      .map(
        (job) => `
      <div class="intake-item">${icon(job.error ? "alert" : "inbox")}<span>${e(job.name)}<small>${e(job.error || (job.total !== undefined ? job.completed + " of " + job.total + " files deleted" : "Processing…"))}</small></span>
        ${job.error ? `<button type="button" data-action="retry" data-job="${e(job.id)}">Retry</button>` : ""}
        ${job.phase !== "cleanup" ? `<button type="button" data-action="cancel-operation" data-job="${e(job.id)}">Cancel</button>` : ""}</div>`,
      )
      .join("")}
  </div>`;
}

export function renderResults(state, resource) {
  const { catalog, data, where } = state;
  const host = $("#results");
  host.className = "results " + state.mode;
  host.dataset.shape = state.shape;
  host.style.setProperty("--preview-ratio", thumbnailRatio(state.shape));
  host.style.setProperty("--card-size", state.size + "px");
  host.style.setProperty("--preview-fit", state.fit);
  host.style.setProperty(
    "--property-count",
    Math.max(1, state.properties.length),
  );
  if (!catalog) {
    const reopen = state.reopenCatalog;
    const content = !state.catalogsLoaded
      ? "<p>Loading libraries…</p>"
      : state.openingCatalog
        ? `<p role="status">Opening ${e(reopen?.title ?? "library")}…</p>`
        : `<div class="welcome-actions">${reopen ? `<button type="button" class="primary" data-action="reopen-catalog">Reopen ${e(reopen.title)}</button>` : ""}<button type="button" data-action="${state.hasCatalogEntries ? "catalogs" : "pick-library"}">Open library</button><button type="button" ${reopen ? "" : 'class="primary"'} data-action="new-catalog">New library</button></div>`;
    host.innerHTML = `<div class="welcome">${icon("library")}<h2>Sourcebook</h2>${content}</div>`;
    return;
  }
  if (!data) return;
  if (where.scope === "inbox") {
    const explanation =
      '<p class="muted">Loose files in staging and pending operations appear here. Captured notes and links go to Files / Inbox by default.</p>';
    host.innerHTML = explanation + inbox(data, state);
    syncThumbnails(host);
    return;
  }
  const children =
    where.scope === "folder" && !state.search
      ? data.folders.filter(({ parent }) => parent === where.folder)
      : [];
  const imports = [...state.importing.values()].filter(
    (draft) => draft.catalog === catalog.id,
  );
  const importing = imports.length
    ? `<section class="pending-imports" aria-label="Importing files"><div class="pending-import-grid">${imports.map(({ file }) => `<div class="pending-import-card">${icon("file")}<span title="${e(file.name)}">${e(file.name)}</span><small>Importing…</small></div>`).join("")}</div></section>`
    : "";
  const previousFolderHeight =
    (host.querySelector(".folder-grid")?.offsetHeight ?? 0) +
    (host.querySelector(".pending-imports")?.offsetHeight ?? 0);
  const fixedHeader =
    previousFolderHeight + (state.mode === "table" ? 30 : 0) + 6;
  const window = resultWindow(host, state, fixedHeader);
  host.classList.toggle("windowed", !!window);
  if (window) {
    host.style.setProperty("--result-columns", window.columns);
    host.style.setProperty("--result-height", window.height + "px");
  }
  reconcileResults(
    host,
    importing +
      (children.length
        ? `<div class="folder-grid">${children
            .map(
              ({ path, name }) =>
                `<button type="button" data-nav="folder" data-path="${e(path)}">${icon("folder")}<span>${e(name)}</span></button>`,
            )
            .join("")}</div>`
        : "") +
      (state.mode === "table" && data.count && state.properties.length
        ? `<div class="table-header"><span></span>${state.properties.map((key) => `<span>${propertyLabels[key]}</span>`).join("")}</div>`
        : "") +
      data.groups
        .filter(({ rows }) => rows.length)
        .map(({ name, rows }) => {
          const slice = window?.slice(name, rows);
          return `<section class="server-group" data-group="${e(name)}" data-offset="${slice?.offset ?? 0}" data-step="${slice?.step ?? 0}">${name ? `<h2 class="group-heading">${e(name)}</h2>` : ""}<div class="server-items">${slice?.top ?? ""}${(slice?.rows ?? rows).map((row) => fileItem(row, state, resource)).join("")}${slice?.bottom ?? ""}</div></section>`;
        })
        .join("") +
      (data.next !== null
        ? '<button type="button" class="load-more-results" data-action="load-more">Load more files</button>'
        : "") +
      (!data.count && !children.length && !imports.length
        ? `<div class="empty-small">${icon("file")}<p>${state.search ? "No matching files." : "No files here."}</p></div>`
        : ""),
  );
  syncThumbnails(host);
}

export function renderInspector(row, resource, suggestions = []) {
  const host = $("#inspector-content");
  if (!row) {
    host.innerHTML =
      '<p class="inspector-empty">Select a file to see its details.</p>';
    return;
  }
  host.innerHTML = `<form id="properties" class="inspector-section" data-revision="${row.revision}">
      ${field("Name", "name", row.title, 'maxlength="240" required')}
      ${field("Tags", "tags", "", 'placeholder="Add a tag" list="tag-suggestions" maxlength="240"')}
      <datalist id="tag-suggestions">${suggestions.map(({ path }) => `<option value="${e(path)}"></option>`).join("")}</datalist>
      <div class="tag-chips">${row.tags.map((tag) => `<button type="button" data-action="remove-tag" data-path="${e(tag)}" aria-label="Remove ${e(tag)}">${e(tag)} ${icon("close")}</button>`).join("")}</div>
      <small data-save-status aria-live="polite"></small>
      ${row.previewStatus === "pending" ? "<small>Thumbnail pending</small>" : ""}
      ${row.previewStatus === "failed" ? `<small>Thumbnail unavailable</small><button type="button" data-action="rebuild-preview" data-path="${e(row.id)}">Rebuild preview</button>` : ""}
      ${row.preview && ["html", "link"].includes(row.type) ? `<button type="button" data-action="rebuild-preview" data-path="${e(row.id)}">Rebuild preview</button>` : ""}
      <label class="field">Notes<textarea name="notes" rows="4" maxlength="64000">${e(row.notes)}</textarea></label>
      <dl class="file-information">
        <dt>Type</dt><dd>${e(row.type)}</dd><dt>Extension</dt><dd>${e(row.extension?.toUpperCase() || "—")}</dd><dt>Original</dt><dd>${e(row.name)}</dd>
        <dt>Folder</dt><dd>${e(row.folder || "Files")}</dd>
        <dt>Size</dt><dd>${formatBytes(row.size)}</dd>
        <dt>Imported</dt><dd>${formatDate(row.modified)}</dd>
        <dt>ID</dt><dd>${e(row.id)}</dd>
      </dl>
      <div class="inspector-actions">
        <button type="submit" hidden>Retry</button><details data-property-conflict hidden><summary>Compare saved properties</summary><pre></pre></details>
        ${row.markdown && row.available ? button("edit-markdown", "Edit Markdown", "edit") : ""}
        ${button("quick-look", "Quick Look", "eye")}
        ${button("resource-actions", "File actions", "more")}
        ${button("move", "Move to folder", "folder", row.available ? "" : "disabled")}
        ${row.available ? `<button type="button" class="icon-button" data-action="download-original" data-path="${e(row.id)}" aria-label="Download file" title="Download file">${icon("download")}</button>` : ""}
      </div>
    </form>`;
}

export function renderToolbar(state) {
  const { catalog, data, where } = state;
  renderLocation(state);
  $("#result-count").textContent =
    catalog && data
      ? where.scope === "inbox"
        ? String(data.inbox.length + data.jobs.length)
        : String(data.count)
      : "";
  $("#thumbnail-size").value = state.size;
  $("#thumbnail-size").disabled = !catalog || where.scope === "inbox";
  $("#search").disabled = !catalog || where.scope === "inbox";
  for (const action of ["upload", "view", "refresh", "settings", "missing"])
    $(`[data-action="${action}"]`).disabled = !catalog;
  $('[data-action="back"]').disabled = state.historyAt <= 0;
  $('[data-action="forward"]').disabled =
    state.historyAt >= state.history.length - 1;
}
