import { viewDefaults } from "../core/view-options.js";
import { libraryFor } from "../local/libraries.js";

const pending = new Map();
const viewKeys = Object.keys(viewDefaults);

export function snapshot(state) {
  return {
    where: state.where,
    viewId: state.viewId,
    selected: state.selected,
    selectedIds: [...state.selectedIds],
    scroll: document.querySelector("#results").scrollTop,
  };
}

export function loadWorkspace(catalog) {
  return libraryFor(catalog.id).workspace;
}

export function rememberWorkspace(state) {
  if (!state.catalog) return;
  state.history[state.historyAt] = snapshot(state);
  const id = state.catalog.id;
  const library = libraryFor(id);
  const { nav, inspector, accent, navWidth, inspectorWidth } = state;
  const workspace = {
    nav,
    inspector,
    accent,
    navWidth,
    inspectorWidth,
    folded: [...state.folded],
    collapsed: [...state.collapsed],
    history: state.history.slice(-40),
    historyAt: Math.max(
      0,
      state.historyAt - Math.max(0, state.history.length - 40),
    ),
  };
  library.workspace = workspace;
  clearTimeout(pending.get(id));
  pending.set(
    id,
    setTimeout(() => {
      pending.delete(id);
      void library
        .write(() =>
          library.files.writeJSON("settings/workspace.json", library.workspace),
        )
        .catch((error) => console.warn("Workspace save failed:", error));
    }, 180),
  );
}

export function applyLocation(state, entry = {}) {
  for (const name of viewKeys) state[name] = entry[name] ?? viewDefaults[name];
  state.where = entry.where ?? { scope: "all" };
  state.viewId = entry.viewId ?? null;
  state.selected = entry.selected ?? null;
  state.selectedIds = new Set(
    entry.selectedIds ?? (state.selected ? [state.selected] : []),
  );
  state.restoreScroll = entry.scroll ?? 0;
  document.querySelector("#search").value = state.search;
}
