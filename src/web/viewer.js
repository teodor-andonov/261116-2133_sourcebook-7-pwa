import { icon } from "./icons.js";
import { $, button, menu, modal } from "./dom.js";
import { json, request } from "./transport.js";

const positions = new Map();
const textKinds = new Set(["text", "code", "html", "link"]);

export function openViewer({
  row: first,
  rows,
  hasMore,
  loadMore,
  resource,
  select,
  fullscreen = false,
  commands,
}) {
  if (!first) return;
  let row = first;
  let page = 1;
  let renderedSource;
  let count = 1;
  let scale = 0;
  let controller;
  const objectUrls = new Set();
  let image;
  let drag;
  const dialog = modal(
    first.title,
    `<div class="server-preview-content" tabindex="0"></div>
    <div class="preview-pagination">
      ${button("previous-file", "Previous file", "back")}
      ${button("next-file", "Next file", "forward")}
      ${button("previous-page", "Previous page", "back")}<span data-pages></span>${button("next-page", "Next page", "forward")}
      <span data-image-controls hidden>
        <button type="button" data-view="out" aria-label="Zoom out">−</button>
        <button type="button" data-view="fit">Fit</button>
        <button type="button" data-view="actual">Actual size</button>
        <button type="button" data-view="in" aria-label="Zoom in">+</button>
      </span>
      <button type="button" data-view="full" aria-label="Fullscreen" aria-pressed="${fullscreen}">${icon("grid")}</button>
      ${button("preview-actions", "Preview actions", "more")}
    </div>`,
    {
      className: "server-preview",
      onClose: () => {
        savePosition();
        cleanup();
      },
    },
  );
  dialog.classList.toggle("fullscreen-viewer", fullscreen);
  const target = $(".server-preview-content", dialog);
  const heading = $("h2", dialog);
  const pages = $("[data-pages]", dialog);
  const filePrev = $('[data-action="previous-file"]', dialog);
  const fileNext = $('[data-action="next-file"]', dialog);
  const prev = $('[data-action="previous-page"]', dialog);
  const next = $('[data-action="next-page"]', dialog);
  const zoomControls = $("[data-image-controls]", dialog);
  const actions = $('[data-action="preview-actions"]', dialog);
  let commandMenu;
  let published;
  let navigation = 0;
  let imageRequest = 0;

  function cleanup() {
    commandMenu?.closeMenu();
    commandMenu = null;
    controller?.abort();
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
    renderedSource = undefined;
    image = undefined;
    const media = target.querySelector("audio,video");
    if (media) {
      media.pause();
      media.removeAttribute("src");
      media.load();
    }
  }

  function key() {
    return resource(row.id) + ":" + row.contentRevision;
  }
  function savePosition() {
    if (positions.size >= 200 && !positions.has(key()))
      positions.delete(positions.keys().next().value);
    positions.set(key(), {
      page,
      scale,
      x: target.scrollLeft,
      y: target.scrollTop,
    });
  }

  function controls() {
    const list = rows();
    const index = list.findIndex(({ id }) => id === row.id);
    filePrev.disabled = index <= 0;
    fileNext.disabled = index < 0 || (index === list.length - 1 && !hasMore());
    prev.hidden = next.hidden = count <= 1;
    prev.disabled = page <= 1;
    next.disabled = page >= count;
    pages.textContent = count > 1 ? page + " / " + count : "";
    zoomControls.hidden = !image;
    actions.disabled = !commands(row).length;
  }

  function applyZoom() {
    if (!image) return;
    image.classList.toggle("preview-zoom", scale > 0);
    image.style.width =
      scale > 0
        ? Math.max(1, Math.round(image.naturalWidth * scale)) + "px"
        : "";
    target.classList.toggle("preview-pannable", scale > 0);
  }

  async function showImage(src, signal, restore = true) {
    const turn = ++imageRequest;
    const nextImage = document.createElement("img");
    nextImage.className = "preview-image";
    nextImage.alt = row.title;
    nextImage.draggable = false;
    nextImage.src = src;
    try {
      await nextImage.decode();
    } catch {
      return false;
    }
    if (signal.aborted || turn !== imageRequest) return false;
    image = nextImage;
    publish(image);
    applyZoom();
    if (restore) {
      const position = positions.get(key());
      target.scrollTo(position?.x ?? 0, position?.y ?? 0);
    }
    controls();
    return true;
  }

  function publish(...content) {
    target.dataset.previewResource = row.id;
    target.replaceChildren(...content);
    target.removeAttribute("aria-busy");
    target.classList.remove("preview-pending");
    published = controller;
  }

  async function blobUrl(path, signal) {
    const response = await request(path, { signal });
    const blob = await response.blob();
    signal.throwIfAborted();
    const url = URL.createObjectURL(blob);
    objectUrls.add(url);
    return { url, response };
  }

  async function show() {
    cleanup();
    controller = new AbortController();
    const { signal } = controller;
    const endpoint = resource(row.id);
    const item = row;
    delete target.dataset.previewResource;
    target.className = "server-preview-content preview-pending";
    target.setAttribute("aria-busy", "true");
    if (!target.firstChild) target.textContent = "Opening preview…";
    heading.textContent = item.title;
    dialog.setAttribute("aria-label", item.title);
    controls();
    try {
      if (!item.available) {
        publish("The original is unavailable.");
      } else if (item.type === "audio" || item.type === "video") {
        const play = document.createElement("button");
        play.type = "button";
        play.textContent = item.type === "audio" ? "Play audio" : "Play video";
        play.onclick = async () => {
          try {
            const { url } = await blobUrl(endpoint + "/media", signal);
            const media = document.createElement(item.type);
            media.controls = true;
            media.playsInline = true;
            media.src = url;
            media.onerror = () => {
              if (!signal.aborted)
                publish(
                  "This format could not be played. Download the original to open it.",
                );
            };
            publish(media);
            await media.play().catch(() => {});
          } catch (error) {
            if (!signal.aborted) publish(error.message);
          }
        };
        publish(play);
        const { url } = await blobUrl(endpoint + "/preview", signal);
        const poster = document.createElement("img");
        poster.className = "web-preview-image";
        poster.alt = item.title;
        poster.src = url;
        if (!signal.aborted && target.contains(play)) target.prepend(poster);
      } else if (textKinds.has(item.type)) {
        const data = await json(endpoint + "/text-preview", { signal });
        if (signal.aborted) return;
        if (data.url) {
          const link = document.createElement("a");
          link.href = data.url;
          link.textContent = data.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          const card = document.createElement("div");
          card.className = "link-quick-look";
          const identity = document.createElement("span");
          identity.className = "link-identity";
          identity.innerHTML = icon("link");
          identity.append(item.link?.domain || new URL(data.url).hostname);
          if (item.link?.favicon && navigator.onLine) {
            const favicon = document.createElement("img");
            favicon.className = "link-favicon";
            favicon.alt = "";
            favicon.referrerPolicy = "no-referrer";
            favicon.src = item.link.favicon;
            identity.append(favicon);
          }
          card.append(identity, link);
          publish(card);
          if (item.link?.hasCover || (item.link?.cover && navigator.onLine)) {
            const cover = document.createElement("img");
            cover.className = "link-cover";
            cover.alt = "";
            cover.referrerPolicy = "no-referrer";
            if (item.link.cover && navigator.onLine)
              cover.src = item.link.cover;
            else cover.src = (await blobUrl(endpoint + "/preview", signal)).url;
            if (!signal.aborted) card.insertBefore(cover, link);
          }
        } else if (typeof data.text === "string") {
          const { textPreview } = await import("./text-preview.js");
          if (signal.aborted) return;
          const content =
            item.type === "html"
              ? document.createElement("iframe")
              : textPreview(data.text, item);
          if (item.type === "html") {
            content.title = item.title;
            content.className = "local-html-preview";
            content.setAttribute("sandbox", "");
            content.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">${data.text}`;
          }
          publish(content);
          if (item.markdown || item.type === "html") {
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.textContent = "Show source";
            let active = content;
            toggle.onclick = async () => {
              try {
                if (active !== content) {
                  active.replaceWith(content);
                  active = content;
                  toggle.textContent = "Show source";
                  return;
                }
                const response = await request(endpoint + "/download", {
                  signal,
                });
                const source = await response.text();
                if (signal.aborted) return;
                const next = textPreview(source, item, { source: true });
                active.replaceWith(next);
                active = next;
                toggle.textContent = "Show preview";
              } catch (error) {
                if (!signal.aborted) publish(error.message);
              }
            };
            target.prepend(toggle);
          }
          if (data.truncated) {
            const note = document.createElement("p");
            note.textContent =
              "Preview truncated. Open the original for the full file.";
            target.append(note);
          }
        } else {
          const { url } = await blobUrl(endpoint + "/preview", signal);
          await showImage(url, signal);
        }
      } else {
        const params = new URLSearchParams({ page });
        const { url, response } = await blobUrl(
          endpoint + "/preview?" + params,
          signal,
        );
        count = Number(response.headers.get("X-Sourcebook-Pages")) || 1;
        renderedSource = url;
        if (!(await showImage(url, signal)) && !signal.aborted)
          throw new Error("The preview could not be displayed.");
        if (item.type === "image" && !signal.aborted)
          target.classList.add("preview-checker");
      }
    } catch (error) {
      if (!signal.aborted && published !== controller) publish(error.message);
    }
    if (!signal.aborted) controls();
  }

  async function changeFile(step) {
    const previous = row;
    const turn = ++navigation;
    let list = rows();
    let index = list.findIndex(({ id }) => id === row.id) + step;
    if (index === list.length && step > 0 && hasMore()) {
      fileNext.disabled = true;
      try {
        await loadMore();
      } catch (error) {
        if (dialog.open && turn === navigation) {
          publish(error.message);
          controls();
        }
        return;
      }
      if (!dialog.open || row !== previous || turn !== navigation) return;
      list = rows();
      index = list.findIndex(({ id }) => id === row.id) + step;
      controls();
    }
    const other = list[index];
    if (!other) return;
    savePosition();
    row = other;
    select(row.id);
    loadPosition();
    void show();
  }
  function loadPosition() {
    const position = positions.get(key());
    page = position?.page ?? 1;
    scale = position?.scale ?? 0;
    count = 1;
  }
  function turnPage(step) {
    const targetPage = page + step;
    if (targetPage < 1 || targetPage > count) return;
    page = targetPage;
    void show();
  }

  actions.setAttribute("aria-haspopup", "menu");
  filePrev.onclick = () => changeFile(-1);
  fileNext.onclick = () => changeFile(1);
  prev.onclick = () => turnPage(-1);
  next.onclick = () => turnPage(1);
  dialog.addEventListener("keydown", (event) => {
    if (event.target.closest("video,audio,input,textarea,select,a,[role=menu]"))
      return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      changeFile(event.key === "ArrowLeft" ? -1 : 1);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      if (count <= 1) return;
      event.preventDefault();
      turnPage(event.key === "PageUp" ? -1 : 1);
    }
  });
  dialog.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="preview-actions"]') === actions) {
      const current = row;
      commandMenu = menu(
        commands(current).map((item) => ({
          ...item,
          run: () => {
            if (item.closeViewer) dialog.close();
            return item.run();
          },
        })),
        { anchor: actions },
      );
      return;
    }
    const action = event.target.closest("[data-view]")?.dataset.view;
    if (action === "full") {
      const expanded = dialog.classList.toggle("fullscreen-viewer");
      event.target
        .closest("[data-view]")
        .setAttribute("aria-pressed", String(expanded));
      return;
    }
    if (!image || !action) return;
    if (
      action === "actual" &&
      row.type === "image" &&
      row.available &&
      row.extension !== "svg"
    ) {
      scale = 1;
      const { signal } = controller;
      void blobUrl(resource(row.id) + "/image", signal)
        .then(({ url }) => showImage(url, signal, false))
        .catch(() => {});
      return;
    }
    if (action === "fit") {
      scale = 0;
      if (renderedSource && image.src !== renderedSource)
        void showImage(renderedSource, controller.signal, false);
      else applyZoom();
      target.scrollTo(0, 0);
    } else {
      scale =
        action === "actual"
          ? 1
          : Math.max(
              0.25,
              Math.min(
                8,
                (scale ||
                  Math.min(
                    1,
                    target.clientWidth / image.naturalWidth,
                    target.clientHeight / image.naturalHeight,
                  )) * (action === "in" ? 1.25 : 0.8),
              ),
            );
      applyZoom();
    }
  });
  target.addEventListener("dblclick", () => {
    if (image) {
      scale = 0;
      if (renderedSource && image.src !== renderedSource)
        void showImage(renderedSource, controller.signal, false);
      else applyZoom();
      target.scrollTo(0, 0);
    }
  });
  target.addEventListener("pointerdown", (event) => {
    if (!image || !scale || event.target !== image || event.button !== 0)
      return;
    drag = {
      x: event.clientX + target.scrollLeft,
      y: event.clientY + target.scrollTop,
    };
    target.setPointerCapture(event.pointerId);
  });
  target.addEventListener("pointermove", (event) => {
    if (drag) target.scrollTo(drag.x - event.clientX, drag.y - event.clientY);
  });
  target.addEventListener("lostpointercapture", () => {
    drag = undefined;
  });
  loadPosition();
  target.focus();
  void show();
}
