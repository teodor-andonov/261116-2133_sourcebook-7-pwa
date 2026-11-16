import { $, button } from "./dom.js";
import { icon } from "./icons.js";

export function mountShell() {
  $("#app").innerHTML = `
    <aside class="navigation" aria-label="Navigation">
      <header class="navigation-header"><span>Library</span></header>
      <nav id="navigation-items"></nav>
      <div class="nav-bottom"><div class="catalog-bar">
        <button type="button" class="catalog-button" data-action="catalogs" aria-label="Switch library">
          ${icon("library")}<span id="catalog-label">Sourcebook</span>${icon("down")}
        </button>
      </div></div>
    </aside>
    <div class="pane-grip left-grip" aria-hidden="true"></div>
    <main class="workspace">
      <div class="toolbar">
        <div class="compact-nav">${button("nav", "Toggle left sidebar", "sidebar")}</div>
        <div class="history-controls">${button("back", "Back", "back")}${button("forward", "Forward", "forward")}</div>
        <div class="location"><div id="breadcrumbs"></div><span id="view-label">All files</span></div>
        <span class="result-count" id="result-count"></span>
        <label class="search"><input id="search" type="search" aria-label="Search files" placeholder='Search or tag = "Architecture"' autocomplete="off" aria-describedby="query-error"></label>
        <input id="thumbnail-size" type="range" min="80" max="300" step="5" aria-label="Thumbnail size">
        ${button("upload", "Add", "plus")}
        <div class="secondary-tools">
          ${button("view", "Filter, sort and display", "grid")}
          ${button("refresh", "Refresh", "refresh")}
        </div>
        ${button("more", "More actions", "more")}
        ${button("inspector", "Toggle right sidebar", "inspector")}
      </div>
      <div id="query-error" role="alert" hidden></div>
      <div id="filter-chips"></div>
      <section id="results" class="results" tabindex="0" aria-label="Files"></section>
      <footer class="statusbar"><span id="status" role="status"></span><span class="spacer"></span><span id="connection-state">On device</span></footer>
    </main>
    <div class="pane-grip right-grip" aria-hidden="true"></div>
    <aside class="inspector" aria-label="Inspector">
      <header><span>Details</span>${button("inspector", "Close inspector", "close")}</header>
      <div id="inspector-content"></div>
      <div class="pane-footer"><span class="app-version">v${__APP_VERSION__}</span>
        ${button("settings", "Settings", "settings")}${button("missing", "Needs attention", "alert")}
        ${button("theme", "Toggle light/dark theme", "moon")}
      </div>
    </aside>
    <button type="button" class="overlay-shade" data-action="close-overlays" aria-label="Close panel" hidden></button>
    <input id="uploads" type="file" multiple hidden>`;
}

export function layout(state) {
  const host = $("#app");
  if (state.navWidth)
    host.style.setProperty("--nav-width", state.navWidth + "px");
  if (state.inspectorWidth)
    host.style.setProperty("--inspector-width", state.inspectorWidth + "px");
  if (state.accent) host.style.setProperty("--accent", state.accent);
  else host.style.removeProperty("--accent");
  const nav = host.clientWidth >= 720 && state.nav;
  const inspector = host.clientWidth >= 1024 && state.inspector;
  host.classList.toggle("nav-docked", nav);
  host.classList.toggle("inspector-docked", inspector);
  host.classList.toggle("nav-overlay", !nav && state.overlay === "nav");
  host.classList.toggle(
    "inspector-overlay",
    !inspector && state.overlay === "inspector",
  );
  $(".overlay-shade").hidden = !host.matches(
    ".nav-overlay, .inspector-overlay",
  );
}
