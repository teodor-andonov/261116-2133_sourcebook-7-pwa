import { clearMediaCache, registerMediaCache } from "./media-cache.js";
import {
  formatQuery,
  parseQuery,
  toggleQueryClause,
} from "../core/query-language.js";
import {
  resolveViewSettings,
  viewDefaults,
  viewProperties,
} from "../core/view-options.js";
import {
  applyLocation,
  loadWorkspace,
  rememberWorkspace,
  snapshot,
} from "./workspace-state.js";
import { editMarkdown } from "./markdown.js";
import { openViewer } from "./viewer.js";
import { fileActions } from "./file-actions.js";
import { propertiesEditor } from "./properties.js";
import { intakeController } from "./intake.js";
import { appBase, storageKey } from "../local/app-location.js";
import "./style.css";
import "./server.css";
import {
  $,
  button,
  escape as e,
  field,
  menu,
  modal,
  popover,
  toast,
} from "./dom.js";
import { icon } from "./icons.js";
import { layout, mountShell } from "./shell.js";
import { downloadOriginal, json, request } from "./transport.js";
import {
  libraryAuthorized,
  loadRecent,
  pickLibrary,
  reopenLibrary,
} from "../local/libraries.js";
import {
  renderInspector,
  renderNav,
  renderResults,
  renderToolbar,
} from "./views.js";

const state = {
  catalog: null,
  reopenCatalog: null,
  openingCatalog: false,
  data: null,
  selected: null,
  selectedIds: new Set(),
  importing: new Map(),
  where: { scope: "all" },
  ...viewDefaults,
  folded: new Set(),
  collapsed: new Set(),
  sidebarOrder: ["views", "tags", "folders"],
  viewId: null,
  restoreScroll: null,
  nav: true,
  inspector: true,
  overlay: null,
  history: [{ scope: "all" }],
  historyAt: 0,
};
const system = matchMedia("(prefers-color-scheme: dark)");
const root = $("#app");
const catalogPath = () =>
  "/local/libraries/" + encodeURIComponent(state.catalog?.id ?? "");
const resource = (id) => catalogPath() + "/resources/" + encodeURIComponent(id);
const selected = () =>
  state.data?.groups
    .flatMap(({ rows }) => rows)
    .find(({ id }) => id === state.selected);
const destination = () =>
  state.where.scope === "folder" ? state.where.folder : "";
const status = (message) => {
  $("#status").textContent = message;
};
const options = (entries, current) =>
  entries
    .map(
      ([value, label]) =>
        `<option value="${e(value)}" ${value === current ? "selected" : ""}>${e(label)}</option>`,
    )
    .join("");
let revision = 0;
let poll;
let statusRequest;
let nextRequest;
let searchTimer;
let tagFilter;
const intake = intakeController({
  state,
  browse,
  status,
  redraw: () => renderResults(state, resource),
});

function theme() {
  const choice = state.catalog?.theme || "system";
  document.documentElement.dataset.theme =
    choice === "system" ? (system.matches ? "dark" : "light") : choice;
  const toggle = $('[data-action="theme"]');
  const dark = document.documentElement.dataset.theme === "dark";
  toggle.innerHTML = icon(dark ? "sun" : "moon");
  toggle.setAttribute(
    "aria-label",
    dark ? "Switch to light theme" : "Switch to dark theme",
  );
}
function closeOverlays() {
  state.overlay = null;
  layout(state);
}
const properties = propertiesEditor({
  catalogPath,
  selected,
  resource,
  browse,
  toast,
});
function drawInspector(row) {
  renderInspector(row, resource, state.data?.tags, state.selectedIds.size);
  properties.restore(row);
}
function select(id, { additive = false, range = false } = {}) {
  if (!range && id) state.selectionAnchor = id;
  if (range && state.selected) {
    const ids = state.data.groups.flatMap(({ rows }) =>
      rows.map(({ id }) => id),
    );
    const start = ids.indexOf(state.selectionAnchor ?? state.selected);
    const end = ids.indexOf(id);
    if (start >= 0 && end >= 0)
      for (const key of ids.slice(
        Math.min(start, end),
        Math.max(start, end) + 1,
      ))
        state.selectedIds.add(key);
  } else if (additive) {
    if (!state.selectedIds.delete(id)) state.selectedIds.add(id);
  } else state.selectedIds = new Set(id ? [id] : []);
  state.selected = state.selectedIds.has(id)
    ? id
    : (state.selectedIds.values().next().value ?? null);
  for (const item of root.querySelectorAll(".file-item")) {
    const active = state.selectedIds.has(item.dataset.id);
    item.classList.toggle("selected", active);
    item.nextElementSibling.checked = active;
    item.setAttribute("aria-pressed", String(active));
  }
  drawInspector(selected());
  rememberWorkspace(state);
}
function draw({ keepInspector = false } = {}) {
  theme();
  renderNav(state);
  renderToolbar(state);
  renderResults(state, resource);
  if (!keepInspector) drawInspector(selected());
}
function browseQuery({ refresh = false, offset = 0 } = {}) {
  const params = new URLSearchParams({
    search: state.where.scope === "inbox" ? "" : state.search,
    scope: state.where.scope,
    group: state.group,
    sort: state.sort,
    type: state.type,
    desc: state.desc ? "1" : "0",
    recursive: state.recursive ? "1" : "0",
    availability: state.availability,
    limit: "240",
    offset: String(offset),
  });
  if (state.where.scope === "folder") params.set("folder", state.where.folder);
  if (state.where.tag) params.set("tag", state.where.tag);
  if (refresh) params.set("refresh", "1");
  return params;
}
async function browse({ refresh = false, background = false } = {}) {
  if (!state.catalog) return;
  if (refresh) {
    const base = catalogPath();
    const settings = await json(base);
    if (base !== catalogPath()) return;
    Object.assign(state.catalog, settings);
    if (settings.sidebarOrder) state.sidebarOrder = settings.sidebarOrder;
  }
  clearTimeout(poll);
  const turn = ++revision;
  const query = browseQuery({ refresh });
  try {
    const data = await json(catalogPath() + "/browse?" + query);
    if (turn !== revision) return;
    state.data = data;
    state.catalog.views = data.views;
    if (state.where.scope === "tag" && !state.where.tagId) {
      const tag = data.tags.find(
        ({ path }) => path.toLowerCase() === state.where.tag.toLowerCase(),
      );
      if (tag) {
        state.where.tagId = tag.id;
        const preset = resolveViewSettings(
          state.catalog,
          state.where,
          state.viewId,
        );
        if (state.catalog.viewPresets?.["tag-id:" + tag.id] && !state.viewId) {
          Object.assign(state, preset);
          $("#search").value = state.search;
          await browse();
          return;
        }
      }
    }
    $("#results").inert = false;
    $("#results").removeAttribute("aria-busy");
    const row = selected();
    const inspectorRevision = $("#properties")?.dataset.revision;
    $("#query-error").hidden = true;
    draw({
      keepInspector: background && row && inspectorRevision === String(row.revision),
    });
    restoreResultScroll();
    if (state.restoreScroll === null) rememberWorkspace(state);
    status(
      data.jobs.some(({ error }) => error)
        ? "Inbox has operations that need attention."
        : data.jobs.length
          ? "Processing files…"
          : "",
    );
    if (data.previewPending || data.jobs.some(({ error }) => !error))
      scheduleActivity();
  } catch (error) {
    if (turn !== revision) return;
    $("#query-error").textContent = error.message;
    $("#query-error").hidden = false;
  }
}
function restoreResultScroll() {
  const host = $("#results");
  const wanted = state.restoreScroll;
  if (wanted === null) return;
  if (
    wanted > host.scrollHeight - host.clientHeight &&
    state.data.next !== null
  ) {
    void run(loadMore);
    return;
  }
  host.scrollTop = wanted;
  state.restoreScroll = null;
  renderResults(state, resource);
  rememberWorkspace(state);
}
function loadMore() {
  const offset = state.data?.next;
  if (!Number.isSafeInteger(offset)) return;
  if (nextRequest?.turn === revision) return nextRequest.promise;
  const turn = revision;
  const promise = loadPage(turn, offset);
  nextRequest = { turn, promise };
  return promise;
}
async function loadPage(turn, offset) {
  try {
    const next = await json(
      catalogPath() + "/browse?" + browseQuery({ offset }),
    );
    if (turn !== revision) return;
    const selectedBefore = selected();
    const all = new Map(
      state.data.groups.map(({ name, rows }) => [name, rows]),
    );
    const seen = new Set(
      [...all.values()].flatMap((rows) => rows.map(({ id }) => id)),
    );
    for (const { name, rows } of next.groups) {
      if (!rows.length) continue;
      if (!all.has(name)) all.set(name, []);
      all.get(name).push(...rows.filter(({ id }) => !seen.has(id)));
    }
    state.data = {
      ...next,
      groups: [...all].map(([name, rows]) => ({ name, rows })),
    };
    renderResults(state, resource);
    if (!selectedBefore && state.selected) drawInspector(selected());
    if (next.previewPending || next.jobs.some(({ error }) => !error))
      scheduleActivity();
  } finally {
    if (nextRequest?.turn === turn) nextRequest = undefined;
  }
  if (turn === revision) restoreResultScroll();
}
function scheduleActivity(delay = 700) {
  clearTimeout(poll);
  poll = setTimeout(() => void run(checkActivity), delay);
}
async function checkActivity() {
  const turn = revision;
  if (!state.data || statusRequest === turn) return;
  statusRequest = turn;
  try {
    const visible = new Set(
      [...$("#results").querySelectorAll(".file-item")].map(
        ({ dataset }) => dataset.id,
      ),
    );
    const pending = state.data.groups
      .flatMap(({ rows }) => rows)
      .filter(
        ({ id, previewStatus }) =>
          visible.has(id) && previewStatus === "pending",
      )
      .slice(0, 240)
      .map(({ id }) => id);
    const jobState = ({ id, phase, error, completed }) => [
      id,
      phase,
      error,
      completed,
    ];
    const before = state.data.jobs.map(jobState);
    const activity = await json(
      catalogPath() +
        "/activity?" +
        new URLSearchParams({ ids: pending.join(",") }),
    );
    if (turn !== revision) return;
    if (
      JSON.stringify(before) !== JSON.stringify(activity.jobs.map(jobState))
    ) {
      await browse({ background: true });
      return;
    }
    const changed = new Map(
      activity.previews.map((preview) => [preview.id, preview]),
    );
    let redraw = false;
    for (const { rows } of state.data.groups) {
      for (const row of rows) {
        const update = changed.get(row.id);
        if (
          update &&
          (row.previewStatus !== update.previewStatus ||
            row.previewToken !== update.previewToken ||
            row.title !== update.title)
        ) {
          Object.assign(row, update);
          redraw = true;
        }
      }
    }
    const previewsSettled =
      state.data.previewPending && !activity.previewPending;
    state.data.previewPending = activity.previewPending;
    if (previewsSettled) {
      await browse({ background: true });
      return;
    }
    if (redraw) renderResults(state, resource);
    if (activity.previewPending || activity.jobs.some(({ error }) => !error))
      scheduleActivity();
  } finally {
    if (statusRequest === turn) statusRequest = undefined;
  }
}
function showLocation(entry) {
  clearTimeout(searchTimer);
  tagFilter = null;
  let where = entry.where ?? { scope: "all" };
  if (entry.viewId) {
    const view = state.catalog.views?.find(({ id }) => id === entry.viewId);
    if (view) where = view.where;
  }
  if (where.scope === "tag" && state.data) {
    const tag = state.data.tags.find(({ id, path }) =>
      where.tagId
        ? id === where.tagId
        : path.toLowerCase() === where.tag.toLowerCase(),
    );
    if (tag) where = { ...where, tag: tag.path, tagId: tag.id };
  }
  applyLocation(state, {
    ...entry,
    ...resolveViewSettings(state.catalog, where, entry.viewId),
    where,
  });
  $("#results").inert = true;
  $("#results").setAttribute("aria-busy", "true");
  $("#results").scrollTop = 0;
  renderInspector(null, resource);
  closeOverlays();
  void browse();
}
function navigate(where, view) {
  rememberWorkspace(state);
  state.history = state.history.slice(0, state.historyAt + 1);
  const entry = {
    ...snapshot(state),
    where,
    search: "",
    selected: null,
    selectedIds: [],
    scroll: 0,
    viewId: null,
  };
  if (view) Object.assign(entry, view, { viewId: view.id });
  state.history.push(entry);
  state.historyAt++;
  showLocation(entry);
}
function stepHistory(step) {
  const next = state.historyAt + step;
  if (next < 0 || next >= state.history.length) return;
  rememberWorkspace(state);
  state.historyAt = next;
  showLocation(state.history[next]);
}
async function openCatalog(catalog) {
  const settings = await json(
    "/local/libraries/" + encodeURIComponent(catalog.id),
  );
  state.catalog = { ...catalog, ...settings };
  state.reopenCatalog = null;
  state.hasCatalogEntries = true;
  catalog = state.catalog;
  state.data = null;
  const saved = loadWorkspace(catalog);
  state.folded = new Set(saved.folded);
  state.collapsed = new Set(saved.collapsed);
  state.sidebarOrder = catalog.sidebarOrder ?? ["views", "tags", "folders"];
  state.nav = saved.nav ?? true;
  state.inspector = saved.inspector ?? true;
  state.navWidth = saved.navWidth ?? 228;
  state.inspectorWidth = saved.inspectorWidth ?? 276;
  state.accent = saved.accent ?? "";
  state.history = saved.history?.length
    ? saved.history
    : [{ mode: catalog.mode }];
  state.historyAt = Math.min(saved.historyAt ?? 0, state.history.length - 1);
  localStorage.setItem(storageKey("sourcebook:catalog"), catalog.id);
  $("#results").replaceChildren();
  const params = new URLSearchParams(location.search);
  const file = params.get("library") === catalog.id ? params.get("file") : null;
  showLocation(
    file
      ? { selected: file, selectedIds: [file] }
      : state.history[state.historyAt],
  );
  if (file) history.replaceState(null, "", appBase);
  theme();
  void run(intake.onOpen);
}
async function restoreCatalog(catalog, prompt = false) {
  if (!catalog || state.openingCatalog) return;
  if (!state.catalog) state.reopenCatalog = catalog;
  state.openingCatalog = true;
  renderResults(state, resource);
  try {
    await openCatalog(await reopenLibrary(catalog.id, prompt));
  } catch (error) {
    if (prompt || error.status !== 403) throw error;
  } finally {
    state.openingCatalog = false;
    if (!state.catalog) renderResults(state, resource);
  }
}

async function resumeCurrentLibrary() {
  const current = state.catalog;
  if (!current || state.openingCatalog || document.hidden) return;
  const authorized = await libraryAuthorized(current.id);
  if (state.catalog?.id !== current.id || document.hidden) return;
  if (authorized) {
    await intake.onOpen();
    return;
  }
  ++revision;
  clearTimeout(poll);
  clearTimeout(searchTimer);
  state.reopenCatalog = { id: current.id, title: current.title };
  state.catalog = null;
  state.data = null;
  state.selected = null;
  state.selectedIds.clear();
  $("#results").inert = false;
  $("#results").removeAttribute("aria-busy");
  draw();
}

function createCatalog() {
  modal("New library", field("Name", "title", "", 'maxlength="80" required'), {
    submit: "Choose empty folder",
    onSubmit: async (data) => {
      try {
        await openCatalog(await pickLibrary(String(data.get("title"))));
      } catch (error) {
        if (error.name !== "AbortError") throw error;
      }
    },
  });
}
async function openPickedLibrary() {
  try {
    await openCatalog(await pickLibrary());
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  }
}
async function chooseCatalog() {
  const catalogs = await loadRecent();
  const dialog = modal(
    "Libraries",
    `<div class="catalog-list">${catalogs
      .map(
        ({ id, title, authorized }) =>
          `<button type="button" data-catalog="${e(id)}">${icon("library")}${e(title)}${authorized ? "" : " · Reopen"}</button>`,
      )
      .join(
        "",
      )}<button type="button" data-open>${icon("folder")}Open library</button>
    <button type="button" class="primary" data-new>${icon("plus")}New library</button></div>`,
  );
  const choose = (action) => async () => {
    try {
      await action();
      dialog.close();
    } catch (error) {
      if (error.name !== "AbortError")
        $(".dialog-error", dialog).textContent = error.message;
    }
  };
  for (const item of dialog.querySelectorAll("[data-catalog]"))
    item.onclick = choose(async () =>
      openCatalog(await reopenLibrary(item.dataset.catalog, true)),
    );
  $("[data-open]", dialog).onclick = choose(async () =>
    openCatalog(await pickLibrary()),
  );
  $("[data-new]", dialog).onclick = () => {
    dialog.close();
    createCatalog();
  };
}

async function relinkOriginal(item) {
  const endpoint = resource(item.id) + "/relink";
  const candidates = await json(endpoint);
  if (!candidates.length) {
    toast("Add the original under Files, then Refresh before relinking.");
    return;
  }
  modal(
    "Relink original",
    `<label class="field">Original<select name="target" required><option value="">Choose a file</option>${options(candidates.map(({ id, name, folder }) => [id, folder ? folder + " / " + name : name]))}</select></label>`,
    {
      submit: "Relink",
      onSubmit: async (form) => {
        const job = await json(endpoint, {
          method: "POST",
          body: { target: form.get("target") },
        });
        if (job.error) throw new Error(job.error);
        await browse();
      },
    },
  );
}
function folderDialog(parent = destination()) {
  modal("New folder", field("Name", "name", "", 'maxlength="180" required'), {
    submit: "Create",
    onSubmit: async (data) => {
      await request(catalogPath() + "/folders", {
        method: "POST",
        body: { parent, name: data.get("name") },
      });
      await browse();
    },
  });
}
function chooseFolder(title, onSubmit) {
  const folders = [
    ["", "Files"],
    ...state.data.folders.map(({ path }) => [path, "Files / " + path]),
  ];
  modal(
    title,
    `<label class="field">Destination<select name="folder">${options(folders, destination())}</select></label>`,
    {
      submit: title,
      onSubmit: async (data) => {
        await onSubmit(String(data.get("folder")));
        await browse();
      },
    },
  );
}
async function updateSettings(patch) {
  const { theme: currentTheme, mode } = state.catalog;
  state.catalog = {
    ...state.catalog,
    ...(await json(catalogPath() + "/settings", {
      method: "PATCH",
      body: { theme: currentTheme, mode, ...patch },
    })),
  };
}
function floatDialog(dialog, anchor) {
  const bounds = anchor?.getBoundingClientRect();
  if (!bounds?.width) return;
  const left = Math.max(
    6,
    Math.min(
      innerWidth - dialog.offsetWidth - 6,
      bounds.right - dialog.offsetWidth,
    ),
  );
  const below = bounds.bottom + 6;
  const top =
    below + dialog.offsetHeight <= innerHeight - 6
      ? below
      : Math.max(6, bounds.top - dialog.offsetHeight - 6);
  Object.assign(dialog.style, {
    margin: "0",
    inset: "auto",
    top: top + "px",
    left: left + "px",
  });
  dialog.classList.add("workspace-flyout");
}
function resizeResults() {
  const host = $("#results");
  const focused = host.contains(document.activeElement)
    ? document.activeElement
    : null;
  const top = host.getBoundingClientRect().top;
  const anchor = [...host.querySelectorAll(".file-entry")].find(
    (entry) => entry.getBoundingClientRect().bottom > top,
  );
  const id = anchor?.dataset.id;
  const offset = anchor?.getBoundingClientRect().top - top;
  renderResults(state, resource);
  if (!id) return;
  let item = host.querySelector(`.file-entry[data-id="${CSS.escape(id)}"]`);
  if (!item) {
    const group = state.data?.groups.find(({ rows }) =>
      rows.some((row) => row.id === id),
    );
    const section = [...host.querySelectorAll("[data-group]")].find(
      (element) => element.dataset.group === group?.name,
    );
    if (group && section?.dataset.step) {
      const index = group.rows.findIndex((row) => row.id === id);
      const grid = section.querySelector(".server-items");
      const columns =
        state.mode === "gallery"
          ? getComputedStyle(grid).gridTemplateColumns.split(" ").length
          : 1;
      host.scrollTop =
        Number(section.dataset.offset) +
        Math.floor(index / columns) * Number(section.dataset.step) -
        offset;
      renderResults(state, resource);
      item = host.querySelector(`.file-entry[data-id="${CSS.escape(id)}"]`);
    }
  }
  if (item) {
    host.scrollTop += item.getBoundingClientRect().top - top - offset;
    renderResults(state, resource);
  }
  if (focused?.isConnected) focused.focus({ preventScroll: true });
}

function liveSearch(value) {
  if (value === state.search) return;
  state.search = $("#search").value = value;
  clearTimeout(searchTimer);
  if (state.where.scope === "inbox") {
    renderResults(state, resource);
    return;
  }
  ++revision;
  searchTimer = setTimeout(() => {
    try {
      parseQuery(value);
      if (value.length <= 1024) {
        state.selected = null;
        state.selectedIds.clear();
      }
    } catch {}
    void browse();
  }, 160);
}

function viewDialog() {
  const inbox = state.where.scope === "inbox";
  const dialog = popover(
    "View",
    `
    <button type="button" data-presets>Saved view settings</button>
    ${
      inbox
        ? ""
        : `<label class="field">Search<input name="search" value="${e(state.search)}"></label>
    <label class="field">Display<select name="mode" aria-label="Display">${options(
      [
        ["gallery", "Gallery"],
        ["list", "List"],
        ["table", "Table"],
      ],
      state.mode,
    )}</select></label>
    <label class="field">Filter by type<select name="type">${options(
      [
        ["", "All types"],
        ["image", "Image"],
        ["pdf", "PDF"],
        ["video", "Video"],
        ["audio", "Audio"],
        ["text", "Text"],
        ["code", "Code"],
        ["link", "Link"],
        ["html", "HTML"],
        ["archive", "Archive"],
        ["file", "Other files"],
      ],
      state.type,
    )}</select></label>
    <label class="field">Sort by<select name="sort">${options(
      [
        ["title", "Name"],
        ["modified", "Imported"],
        ["type", "Type"],
        ["size", "Size"],
      ],
      state.sort,
    )}</select></label>
    <label class="field">Group by<select name="group">${options(
      [
        ["none", "None"],
        ["type", "Type"],
        ["extension", "Extension"],
        ["folder", "Folder"],
        ["status", "Availability"],
      ],
      state.group,
    )}</select></label>
<label><input name="desc" type="checkbox" ${state.desc ? "checked" : ""}> Descending</label>
    <label><input name="recursive" type="checkbox" ${state.recursive ? "checked" : ""}> Include subfolders</label>
    <label class="field">Availability<select name="availability">${options(
      [
        ["", "Any"],
        ["available", "Available"],
        ["unavailable", "Unavailable"],
      ],
      state.availability,
    )}</select></label>
    <label class="field">Thumbnail shape<input type="range" name="shape" min="-1" max="1" step="0.05" value="${typeof state.shape === "number" ? state.shape : ({ portrait: -1, landscape: 1 }[state.shape] ?? 0)}"></label>
    <div class="range-labels"><span>Portrait</span><span>Square</span><span>Landscape</span></div>
    <fieldset><legend>Tag filter</legend><label class="field">Tags<select name="filterTags" aria-label="Tags" multiple size="4">${state.data?.tags.map(({ path }) => `<option value="${e(path)}" ${tagFilter?.paths.includes(path) ? "selected" : ""}>${e(path)}</option>`).join("") ?? ""}</select></label>
    <label class="field">Match<select name="tagMatch"><option value="and">All</option><option value="or" ${tagFilter?.match === "or" ? "selected" : ""}>Any</option></select></label>
    </fieldset>
    <label class="field">Image fit<select name="fit">${options(
      [
        ["contain", "Fit"],
        ["cover", "Fill"],
      ],
      state.fit,
    )}</select></label>
    <fieldset><legend>Properties</legend><div class="property-options">${viewProperties.map((property) => `<label><input type="checkbox" name="properties" value="${property}" ${state.properties.includes(property) ? "checked" : ""}> ${property}</label>`).join("")}</div></fieldset>`
    }`,
    {
      anchor: $('[data-action="view"]'),
      onChange: async (data, event) => {
        if (inbox) {
          if (event.target.name === "search") liveSearch(data.get("search"));
          else {
            state.sort = data.get("sort");
            state.desc = data.has("desc");
            renderResults(state, resource);
          }
          return;
        }
        if (event.target.name === "search") {
          tagFilter = null;
          for (const option of dialog.querySelector('[name="filterTags"]')
            .options)
            option.selected = false;
          liveSearch(data.get("search"));
          return;
        }
        if (["filterTags", "tagMatch"].includes(event.target.name)) {
          const paths = data.getAll("filterTags");
          const match = data.get("tagMatch");
          const base = parseQuery(tagFilter?.base ?? state.search);
          const clauses = paths.map((value) => ({
            field: "tag",
            op: "=",
            value,
          }));
          const filter = clauses.length > 1 ? { [match]: clauses } : clauses[0];
          const search = formatQuery(
            base && filter ? { and: [base, filter] } : base || filter,
          );
          tagFilter = { base: formatQuery(base), paths, match };
          dialog.querySelector('[name="search"]').value = search;
          liveSearch(search);
          return;
        }
        const previous = browseQuery().toString();
        for (const key of [
          "mode",
          "type",
          "sort",
          "group",
          "availability",
          "fit",
        ])
          state[key] = data.get(key);
        const shape = Number(data.get("shape"));
        state.shape =
          { "-1": "portrait", 0: "square", 1: "landscape" }[shape] ?? shape;
        state.desc = data.has("desc");
        state.recursive = data.has("recursive");
        state.properties = data.getAll("properties");
        if (previous !== browseQuery().toString()) {
          state.selected = null;
          state.selectedIds.clear();
          await browse();
        } else resizeResults();
      },
    },
  );
  const trigger = dialog.querySelector("[data-presets]");
  trigger.onclick = () => {
    const target = { ...state.where, viewId: state.viewId };
    const folder = target.scope === "folder" && !target.viewId;
    const save = async (mode) => {
      const values = Object.fromEntries(
        Object.keys(viewDefaults).map((key) => [key, state[key]]),
      );
      const base = catalogPath();
      const settings = await json(base + "/view-settings", {
        method: "PUT",
        body: { target, mode, values },
      });
      if (!state.catalog || catalogPath() !== base) return;
      Object.assign(state.catalog, settings);
      if (mode === "none") {
        const current = snapshot(state);
        dialog.dismiss();
        showLocation(current);
      }
    };
    menu(
      [
        { label: "None", icon: "close", run: () => save("none") },
        {
          label: folder ? "This folder" : "This tab",
          icon: "pin",
          run: () => save("local"),
        },
        ...(folder
          ? [
              {
                label: "This folder and subfolders",
                icon: "folder",
                run: () => save("tree"),
              },
            ]
          : []),
        {
          label: "Save as library default",
          icon: "library",
          run: () => save("default"),
        },
      ],
      { anchor: trigger },
    );
  };
}
function editSavedView(view, nameOnly = false) {
  if (!state.catalog || (state.where.scope === "inbox" && !view)) return;
  const repairLocation = !!view?.unavailable;
  const folderField = repairLocation
    ? `<label class="field">Starting folder<select name="folder">${options([["", "Files"], ...state.data.folders.map(({ path }) => [path, path])], "")}</select></label>`
    : "";
  modal(
    view ? "Update view" : "Save view",
    field("View name", "name", view?.name ?? "", 'maxlength="80" required') +
      folderField,
    {
      onSubmit: async (data) => {
        const id = view ? "/" + view.id : "";
        const saved = await json(catalogPath() + "/views" + id, {
          method: view ? "PUT" : "POST",
          body: {
            ...(nameOnly
              ? view
              : {
                  where: state.where,
                  ...Object.fromEntries(
                    Object.keys(viewDefaults).map((key) => [key, state[key]]),
                  ),
                }),
            ...(repairLocation
              ? {
                  where: { scope: "folder", folder: data.get("folder") },
                  repairLocation: true,
                }
              : nameOnly
                ? { nameOnly: true }
                : {}),
            name: data.get("name"),
          },
        });
        if (!nameOnly) state.viewId = saved.id;
        Object.assign(state.catalog, await json(catalogPath()));
        await browse();
      },
    },
  );
}
function removeSavedView(view) {
  if (!view) return;
  modal("Delete view", `<p>Delete ${e(view.name)}?</p>`, {
    submit: "Delete",
    onSubmit: async () => {
      await request(catalogPath() + "/views/" + view.id, { method: "DELETE" });
      if (state.viewId === view.id) state.viewId = null;
      Object.assign(state.catalog, await json(catalogPath()));
      await browse();
    },
  });
}
const activeView = () =>
  state.data?.views.find(({ id }) => id === state.viewId);
function settingsDialog() {
  const inboxChoices = [
    ["default", "Inbox (default)"],
    ["folder:", "Files"],
    ...(state.data?.folders ?? []).map(({ path }) => [
      "folder:" + path,
      "Files / " + path,
    ]),
  ];
  const dialog = modal(
    "Settings",
    `<label class="field">Appearance<select name="theme">${options(
      [
        ["system", "System"],
        ["light", "Light"],
        ["dark", "Dark"],
      ],
      state.catalog.theme,
    )}</select></label><label class="field">Accent<select name="accent">${options(
      [
        ["", "Default"],
        ["#708bbf", "Blue"],
        ["#539378", "Green"],
        ["#a46786", "Rose"],
        ["#b47c49", "Amber"],
      ],
      state.accent,
    )}</select></label><label class="field">Capture destination<select name="capture">${options(inboxChoices, state.catalog.captureFolder === undefined ? "default" : "folder:" + state.catalog.captureFolder)}</select></label><label class="field">Quick Look<select name="quickLookMode">${options(
      [
        ["popup", "Popup"],
        ["fullscreen", "Fullscreen"],
      ],
      state.catalog.quickLookMode ?? "popup",
    )}</select></label><fieldset><legend>View · Display Settings</legend><label><input name="fileBadge" type="checkbox" ${state.catalog.fileBadge !== false ? "checked" : ""}> File type badge</label></fieldset><button type="button" data-clear-media>Clear local cache</button>`,
    {
      onSubmit: async (data) => {
        const folder = String(data.get("capture"));
        await updateSettings({
          theme: data.get("theme"),
          fileBadge: data.has("fileBadge"),
          quickLookMode: data.get("quickLookMode"),
          captureFolder: folder === "default" ? null : folder.slice(7),
        });
        if (folder === "default") delete state.catalog.captureFolder;
        renderResults(state, resource);
        state.accent = data.get("accent");
        rememberWorkspace(state);
        layout(state);
        theme();
      },
    },
  );
  floatDialog(dialog, $('[data-action="settings"]'));
  $("[data-clear-media]", dialog).onclick = async () => {
    try {
      await clearMediaCache();
      toast("Local preview cache cleared.");
    } catch (error) {
      $(".dialog-error", dialog).textContent = error.message;
    }
  };
}
async function addFiles(files) {
  if (state.catalog && files.length)
    await intake.queue(files, { managed: false, folder: destination() });
}
function quickLook(row) {
  openViewer({
    row,
    fullscreen: state.catalog?.quickLookMode === "fullscreen",
    commands: (item) => resourceCommands(item, true),
    rows: () => state.data?.groups.flatMap(({ rows }) => rows) ?? [],
    hasMore: () => state.data?.next != null,
    loadMore: () => loadMore(),
    resource,
    select,
  });
}
function togglePane(name) {
  const wide = root.clientWidth >= (name === "nav" ? 720 : 1024);
  if (wide && state[name]) {
    state[name] = false;
    state.overlay = null;
  } else if (wide) {
    state[name] = true;
    state.overlay = null;
  } else state.overlay = state.overlay === name ? null : name;
  layout(state);
  rememberWorkspace(state);
}
const files = fileActions({
  state,
  catalogPath,
  resource,
  selected,
  browse,
  chooseFolder,
  onTagSaved: properties.acceptTagResult,
  openView: (id) => {
    const view = state.data.views.find((item) => item.id === id);
    if (view?.unavailable) toast("This view’s folder is unavailable.");
    else if (view) navigate(view.where, view);
  },
});
const commandLabels = {
  move: ["Move to folder", "folder"],
  copy: ["Copy to folder", "copy"],
  delete: ["Delete files", "trash"],
  "tag-files": ["Tag files", "tag"],
  "share-link": ["Share file", "link"],
  "copy-link": ["Copy library link", "copy"],
  "edit-markdown": ["Edit Markdown", "edit"],
  "rebuild-preview": ["Rebuild preview", "refresh"],
  "capture-screenshot": ["Capture website screenshot", "image"],
};
const command = (action, label, icon, data) => ({
  label: label ?? commandLabels[action][0],
  icon: icon ?? commandLabels[action][1],
  run: () => run(actions[action], data),
});
function resourceCommands(item, viewer) {
  const forItem = (action) => ({
    ...command(action),
    closeViewer:
      viewer &&
      ["edit-markdown", "move", "copy", "delete", "tag-files"].includes(action),
    run: () => {
      if (viewer || !state.selectedIds.has(item.id)) select(item.id);
      return run(actions[action], { path: item.id });
    },
  });
  const rebuild = command(
    "rebuild-preview",
    undefined,
    undefined,
    viewer ? { path: item.id } : undefined,
  );
  return [
    ...(item.available
      ? [
          {
            label: "Download original",
            icon: "download",
            run: () => run(() => downloadOriginal(resource(item.id))),
          },
          ...(item.markdown ? [forItem("edit-markdown")] : []),
          rebuild,
          ...(item.type === "link" ? [forItem("capture-screenshot")] : []),
          forItem("move"),
          forItem("copy"),
          forItem("share-link"),
          forItem("copy-link"),
        ]
      : []),
    ...(!item.available
      ? [
          ...(!viewer && state.selectedIds.size > 1 ? [rebuild] : []),
          {
            label: "Relink original",
            icon: "link",
            run: () => run(relinkOriginal, item),
          },
        ]
      : []),
    forItem("tag-files"),
    forItem("delete"),
  ];
}
function moreActions(anchor = $('[data-action="more"]'), point) {
  menu(
    [
      command("catalogs", "Switch library", "library"),
      ...(state.catalog
        ? [
            command("view", "Filter, sort and display", "grid"),
            command("refresh", "Refresh", "refresh"),
            ...(state.where.scope !== "inbox"
              ? [command("save-view", "Save view", "eye")]
              : []),
          ]
        : []),
      ...(activeView()
        ? [
            command("update-view", "Update view", "edit"),
            command("delete-view", "Delete view", "trash"),
          ]
        : []),
      ...(state.selectedIds.size
        ? [
            command("tag-files"),
            command("rebuild-preview"),
            command("move"),
            command("copy"),
            command("delete"),
            command("share-link"),
            command("copy-link"),
          ]
        : []),
    ],
    { anchor, ...point },
  );
}

async function changeTree(nav, path, change) {
  const endpoint = nav === "tag" ? "/tag-branch" : "/folders";
  const body =
    nav === "tag" ? { path, ...change } : { folder: path, ...change };
  const base = catalogPath();
  await request(base + endpoint, { method: "PATCH", body });
  const settings = await json(base);
  if (base !== catalogPath()) return;
  Object.assign(state.catalog, settings);
  const replacementPath = change.rename ?? change.destination;
  if (replacementPath) {
    for (const entry of state.history) {
      if (entry.where?.scope !== nav) continue;
      const value = nav === "tag" ? entry.where.tag : entry.where.folder;
      if (value === path || value?.startsWith(path + "/"))
        entry.where = {
          ...entry.where,
          [nav]: replacementPath + value.slice(path.length),
        };
    }
  }
  const active = nav === "tag" ? state.where.tag : state.where.folder;
  const replacement = change.rename ?? change.destination;
  if (
    active &&
    (active === path || active.startsWith(path + "/")) &&
    (replacement || change.before === undefined)
  ) {
    navigate(
      replacement
        ? nav === "tag"
          ? {
              scope: "tag",
              tag: replacement + active.slice(path.length),
              tagId: state.where.tagId,
            }
          : { scope: "folder", folder: replacement + active.slice(path.length) }
        : { scope: "all" },
    );
  } else await browse();
}

function editTree(nav, path) {
  const initial = path;
  modal(
    nav === "folder" ? "Move or rename folder" : "Move or rename tag",
    field("Destination path", "path", initial, 'required maxlength="240"'),
    {
      onSubmit: (data) =>
        changeTree(
          nav,
          path,
          nav === "folder"
            ? { destination: data.get("path") }
            : { rename: data.get("path") },
        ),
    },
  );
}

async function deleteFolder(path) {
  const info = await json(
    catalogPath() + "/folders/inspect?" + new URLSearchParams({ folder: path }),
  );
  modal(
    "Delete folder",
    `<p>Delete ${e(path)}, including ${info.files} files and ${info.folders} subfolders?</p>`,
    {
      submit: "Delete",
      onSubmit: () => changeTree("folder", path, { token: info.token }),
    },
  );
}

function treeOrderMenu(nav, path) {
  const parent = path.split("/").slice(0, -1).join("/");
  const siblings = state.data[nav === "tag" ? "tags" : "folders"].filter(
    (item) =>
      item.path !== path &&
      item.path.split("/").slice(0, -1).join("/") === parent,
  );
  modal(
    "Reorder " + nav,
    `<label class="field">Place before<select name="before">${options(
      [
        ...siblings.map((item) => [
          nav === "tag" ? item.id : item.path,
          item.path,
        ]),
        ["", "End of section"],
      ],
      "",
    )}</select></label>`,
    {
      onSubmit: (data) =>
        changeTree(nav, path, { before: data.get("before") || null }),
    },
  );
}

function navigationMenu({ nav, path }, anchor, point) {
  const filters = (field, op) => [
    command("filter-clause", "Include in search", "plus", { field, op, path }),
    command("filter-clause", "Exclude from search", "close", {
      field,
      op: "!" + op,
      path,
    }),
  ];
  const view = state.data.views.find(({ id }) => id === path);
  const items = {
    tag: () => [
      ...filters("tag", "="),
      command(
        "pin-tag",
        state.data.pinnedTags.includes(path) ? "Unpin tag" : "Pin tag",
        "pin",
        { path },
      ),
      {
        label: "Move or rename tag",
        icon: "edit",
        run: () => editTree("tag", path),
      },
      {
        label: "Reorder tag",
        icon: "up",
        run: () => treeOrderMenu("tag", path),
      },
    ],
    folder: () => [
      { label: "New folder", icon: "folder", run: () => folderDialog(path) },
      ...(path
        ? [
            ...filters("folder", "~"),
            {
              label: "Move or rename folder",
              icon: "edit",
              run: () => editTree("folder", path),
            },
            {
              label: "Reorder folder",
              icon: "up",
              run: () => treeOrderMenu("folder", path),
            },
            {
              label: "Delete folder",
              icon: "trash",
              run: () => deleteFolder(path),
            },
          ]
        : []),
    ],
    view: () =>
      view
        ? [
            {
              label: "Edit view",
              icon: "edit",
              run: () => editSavedView(view, view.id !== state.viewId),
            },
            {
              label: "Delete view",
              icon: "trash",
              run: () => removeSavedView(view),
            },
          ]
        : [],
  }[nav]?.();
  if (items?.length) menu(items, { anchor, ...point });
}
const actions = {
  "edit-markdown": async () => {
    const row = selected();
    if (!row?.markdown || !row.available) return;
    await editMarkdown(row, resource(row.id), async () => {
      await browse();
    });
  },
  catalogs: chooseCatalog,
  "new-catalog": createCatalog,
  "reopen-catalog": () => restoreCatalog(state.reopenCatalog, true),
  "pick-library": openPickedLibrary,
  folder: () => folderDialog(),
  view: viewDialog,
  "clear-tag-location": () => navigate({ scope: "all" }),
  "parent-folder": ({ path }) => navigate({ scope: "folder", folder: path }),
  "save-view": () => editSavedView(),
  "update-view": () => editSavedView(activeView()),
  "delete-view": () => removeSavedView(activeView()),
  "filter-clause": async ({ field, op, path }) => {
    state.selected = null;
    state.selectedIds.clear();
    state.search = $("#search").value = toggleQueryClause(
      state.search,
      field,
      op,
      path,
    );
    await browse();
  },
  "toggle-section": ({ path }) => {
    if (!state.collapsed.delete(path)) state.collapsed.add(path);
    rememberWorkspace(state);
    renderNav(state);
  },
  "move-section": async ({ path }) => {
    const index = state.sidebarOrder.indexOf(path);
    if (index < 0) return;
    const next =
      (index + state.sidebarOrder.length - 1) % state.sidebarOrder.length;
    [state.sidebarOrder[next], state.sidebarOrder[index]] = [
      state.sidebarOrder[index],
      state.sidebarOrder[next],
    ];
    await updateSettings({ sidebarOrder: state.sidebarOrder });
    rememberWorkspace(state);
    renderNav(state);
  },
  settings: settingsDialog,
  more: () => moreActions(),
  upload: () =>
    menu(
      [
        { label: "Folder", icon: "folder", run: folderDialog },
        { label: "Note", icon: "edit", run: () => intake.composer() },
        {
          label: "From file system",
          icon: "plus",
          run: () => $("#uploads").click(),
        },
      ],
      { anchor: $('[data-action="upload"]') },
    ),

  refresh: () => browse({ refresh: true }),
  "quick-look": () => quickLook(selected()),
  "download-original": ({ path }) => downloadOriginal(resource(path)),
  "resource-actions": () => {
    const item = selected();
    if (item)
      menu(resourceCommands(item), {
        anchor: $('[data-action="resource-actions"]'),
      });
  },
  "rebuild-preview": async ({ path } = {}) => {
    const ids = path ? [path] : [...state.selectedIds];
    await Promise.all(
      ids.map((id) =>
        request(resource(id) + "/preview/rebuild", { method: "POST" }),
      ),
    );
    await browse();
  },
  "capture-screenshot": async ({ path }) => {
    if (!navigator.onLine)
      throw new Error("Connect to capture a website screenshot.");
    await request(resource(path) + "/preview/rebuild?screenshot=1", {
      method: "POST",
    });
    await browse();
  },
  nav: () => togglePane("nav"),
  inspector: () => togglePane("inspector"),
  "close-overlays": closeOverlays,
  missing: () => intake.attention(() => navigate({ scope: "missing" })),
  capture: () => intake.composer(),
  "load-more": loadMore,
  fold: ({ path }) => {
    if (!state.folded.delete(path)) state.folded.add(path);
    rememberWorkspace(state);
    renderNav(state);
  },
  ...files.commands,
  "remove-tag": ({ path }) =>
    files.tags([], [path], [selected()?.id].filter(Boolean)),
  "nav-actions": ({ navKind, path }) =>
    navigationMenu({ nav: navKind, path }, document.activeElement),
  process: ({ name }) =>
    chooseFolder("Process", (folder) =>
      json(catalogPath() + "/inbox", {
        method: "POST",
        body: { name, folder },
      }),
    ),
  "cancel-operation": async ({ job }) => {
    await json(
      catalogPath() + "/operations/" + encodeURIComponent(job) + "/cancel",
      { method: "POST" },
    );
    await browse();
  },
  "cancel-all": async () => {
    const result = await json(catalogPath() + "/operations/cancel", {
      method: "POST",
    });
    const remaining = result.filter(({ phase }) => phase !== "cancelled");
    if (remaining.length) toast(remaining.length + " already finishing.");
    await browse();
  },
  retry: async ({ job }) => {
    await json(
      catalogPath() + "/operations/" + encodeURIComponent(job) + "/retry",
      { method: "POST" },
    );
    await browse();
  },
  theme: async () => {
    if (!state.catalog) return;
    await updateSettings({
      theme:
        document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    });
    theme();
  },
  back: () => stepHistory(-1),
  forward: () => stepHistory(1),
};
async function run(action, data) {
  try {
    await action?.(data);
  } catch (error) {
    toast(error.message);
  }
}

mountShell();
$("#thumbnail-size").oninput = (event) => {
  state.size = Number(event.target.value);
  resizeResults();
};
intake.connect(root, run);
document.addEventListener("keydown", (event) => files.keydown(event, run));
const treeType = "application/x-sourcebook-tree";
let treeDrag;
const treeRow = (event) =>
  event.target.closest('[data-nav="tag"], [data-nav="folder"]');
function treeDrop(event) {
  const row = treeRow(event);
  if (
    !treeDrag ||
    !row ||
    row.dataset.nav !== treeDrag.nav ||
    treeDrag.path === row.dataset.path
  )
    return;
  const rect = row.getBoundingClientRect();
  const before = event.clientY < rect.top + rect.height * 0.3;
  const parent = (path) => path.split("/").slice(0, -1).join("/").toLowerCase();
  const target = row.dataset.path;
  if (before && target && parent(target) !== parent(treeDrag.path)) return;
  if (
    !before &&
    target?.toLowerCase().startsWith(treeDrag.path.toLowerCase() + "/")
  )
    return;
  return { row, before };
}
root.addEventListener("dragstart", (event) => {
  const row = treeRow(event);
  if (!row?.dataset.path || !row.draggable) return;
  treeDrag = { ...row.dataset };
  event.dataTransfer.setData(treeType, "internal");
  event.dataTransfer.effectAllowed = "move";
});
root.addEventListener("dragover", (event) => {
  const drop = treeDrop(event);
  $(".tree-drop")?.classList.remove("tree-drop", "tree-before");
  if (!drop) return;
  event.preventDefault();
  drop.row.classList.add("tree-drop");
  drop.row.classList.toggle("tree-before", drop.before);
});
root.addEventListener(
  "drop",
  (event) => {
    if (!event.dataTransfer.types.includes(treeType)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const drop = treeDrop(event);
    const drag = treeDrag;
    treeDrag = undefined;
    $(".tree-drop")?.classList.remove("tree-drop", "tree-before");
    if (!drop) return;
    const target = drop.row.dataset.path;
    const name = drag.path.split("/").at(-1);
    const next = target ? target + "/" + name : name;
    const change =
      drop.before && target
        ? { before: drag.nav === "tag" ? drop.row.dataset.tagId : target }
        : drag.nav === "tag"
          ? { rename: next, before: null }
          : { destination: next };
    void run(() => changeTree(drag.nav, drag.path, change));
  },
  true,
);
root.addEventListener("dragend", () => {
  treeDrag = undefined;
  $(".tree-drop")?.classList.remove("tree-drop", "tree-before");
});
root.addEventListener(
  "error",
  (event) => {
    if (event.target.matches?.(".link-cover, .link-favicon"))
      event.target.hidden = true;
  },
  true,
);
root.addEventListener("dragstart", files.dragstart);
root.addEventListener("dragend", files.dragend);
root.addEventListener("dragover", files.dragover);
root.addEventListener("drop", (event) => files.drop(event, run), true);
for (const [selector, name, direction] of [
  [".left-grip", "navWidth", 1],
  [".right-grip", "inspectorWidth", -1],
]) {
  const grip = $(selector);
  grip.onpointerdown = (event) => {
    const start = event.clientX;
    const width = state[name];
    grip.setPointerCapture(event.pointerId);
    grip.onpointermove = (move) => {
      state[name] = Math.round(
        Math.max(
          160,
          Math.min(440, width + direction * (move.clientX - start)),
        ),
      );
      layout(state);
    };
  };
  grip.onlostpointercapture = () => {
    grip.onpointermove = null;
    rememberWorkspace(state);
  };
}
draw();
layout(state);
new ResizeObserver(() => layout(state)).observe(root);
system.addEventListener("change", theme);
root.addEventListener("click", (event) => {
  if (event.target.matches("[data-select-id]")) return;
  const target = event.target.closest("[data-action], [data-nav], .file-item");
  if (!target) return;
  const { action, nav, path, id } = target.dataset;
  if (action) void run(actions[action], target.dataset);
  else if (nav === "view") {
    const view = state.data.views.find(({ id }) => id === path);
    if (view?.unavailable) toast("This view’s folder is unavailable.");
    else if (view) navigate(view.where, view);
  } else if (nav)
    navigate({
      scope: nav,
      ...(nav === "folder"
        ? { folder: path }
        : nav === "tag"
          ? {
              tag: path,
              tagId: state.data.tags.find((tag) => tag.path === path)?.id,
            }
          : {}),
    });
  else if (id)
    select(id, {
      additive: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
});
root.addEventListener("change", (event) => {
  const id = event.target.dataset.selectId;
  if (id) select(id, { additive: true });
});
root.addEventListener("contextmenu", (event) => {
  const point = { x: event.clientX, y: event.clientY };
  const nav = event.target.closest(
    '[data-nav="tag"], [data-nav="folder"], [data-nav="view"]',
  );
  if (nav) {
    event.preventDefault();
    navigationMenu(nav.dataset, nav, point);
    return;
  }
  const item = event.target.closest(".file-item");
  if (!item) return;
  event.preventDefault();
  if (!state.selectedIds.has(item.dataset.id)) select(item.dataset.id);
  const row = state.data.groups
    .flatMap(({ rows }) => rows)
    .find(({ id }) => id === item.dataset.id);
  if (row) menu(resourceCommands(row), { anchor: item, ...point });
});
root.addEventListener("dblclick", (event) => {
  if (event.target.closest(".file-item")) quickLook(selected());
});
root.addEventListener("keydown", (event) => {
  if (
    event.key !== "Enter" ||
    event.isComposing ||
    !event.target.matches("#properties [name=tags]")
  )
    return;
  event.preventDefault();
  const row = selected();
  const value = event.target.value.trim();
  if (!row || !value) return;
  event.target.value = "";
  void run(() => files.tags([value], [], [row.id]));
});
root.addEventListener("input", properties.input);
root.addEventListener("submit", properties.submit);
let scrollTimer;
let renderFrame;
const resultsHost = $("#results");
function refreshWindow() {
  if (
    state.where.scope === "inbox" ||
    (state.data?.count ?? 0) < 120 ||
    renderFrame
  )
    return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = undefined;
    renderResults(state, resource);
  });
}
new ResizeObserver(refreshWindow).observe(resultsHost);
resultsHost.addEventListener("scroll", () => {
  refreshWindow();
  clearTimeout(scrollTimer);
  if (state.restoreScroll === null) {
    scrollTimer = setTimeout(() => {
      rememberWorkspace(state);
      if (
        resultsHost.scrollTop + resultsHost.clientHeight + 300 >
        resultsHost.scrollHeight
      )
        void run(loadMore);
      if (
        state.data?.groups.some(({ rows }) =>
          rows.some(({ previewStatus }) => previewStatus === "pending"),
        )
      )
        scheduleActivity(200);
    }, 100);
  }
});
window.addEventListener("pagehide", () => rememberWorkspace(state));
$("#search").addEventListener("input", (event) => {
  tagFilter = null;
  liveSearch(event.target.value);
});
$("#uploads").addEventListener("change", (event) => {
  const files = [...event.target.files];
  event.target.value = "";
  void run(() => addFiles(files));
});
$("#results").addEventListener("keydown", (event) => {
  const arrows = [
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Home",
    "End",
  ];
  if (arrows.includes(event.key)) {
    const groups = state.data?.groups ?? [];
    const items = groups.flatMap(({ rows }) => rows);
    if (!items.length) return;
    const active = document.activeElement.closest(".file-item");
    const at = items.findIndex(
      ({ id }) => id === (active?.dataset.id || state.selected),
    );
    const mountedGroup =
      active?.closest(".server-items") ??
      resultsHost.querySelector(".server-items");
    const columns =
      state.mode === "gallery" && mountedGroup
        ? getComputedStyle(mountedGroup).gridTemplateColumns.split(" ").length
        : 1;
    const step =
      { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[
        event.key
      ] ?? 0;
    const target =
      items[
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? items.length - 1
            : Math.max(0, Math.min(items.length - 1, at + step))
      ];
    event.preventDefault();
    select(target.id, { range: event.shiftKey });
    const itemSelector = '.file-item[data-id="' + target.id + '"]';
    if (
      !resultsHost.querySelector(itemSelector) &&
      resultsHost.classList.contains("windowed")
    ) {
      const group = groups.find(({ rows }) => rows.includes(target));
      const section = [...resultsHost.querySelectorAll("[data-group]")].find(
        ({ dataset }) => dataset.group === group?.name,
      );
      if (section) {
        resultsHost.scrollTop =
          Number(section.dataset.offset) +
          Math.floor(group.rows.indexOf(target) / columns) *
            Number(section.dataset.step);
        renderResults(state, resource);
      }
    }
    resultsHost.querySelector(itemSelector)?.focus();
    return;
  }
  if (
    event.code === "Space" &&
    selected() &&
    !event.target.matches("[data-select-id]")
  ) {
    event.preventDefault();
    quickLook(selected());
  }
});
document.addEventListener(
  "visibilitychange",
  () => void run(resumeCurrentLibrary),
);
window.addEventListener("pageshow", () => void run(resumeCurrentLibrary));
void run(async () => {
  registerMediaCache();
  const entries = await loadRecent(false);
  const linked = new URLSearchParams(location.search).get("library");
  const recent =
    linked || localStorage.getItem(storageKey("sourcebook:catalog"));
  const catalog = entries.find(({ id }) => id === recent) ?? entries[0];
  state.catalogsLoaded = true;
  state.hasCatalogEntries = entries.length > 0;
  renderResults(state, resource);
  await restoreCatalog(catalog);
});
