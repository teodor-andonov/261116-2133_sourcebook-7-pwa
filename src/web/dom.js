import { icon } from "./icons.js";
export const $ = (selector, host = document) => host.querySelector(selector);
export const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const button = (action, name, glyph, extra = "") =>
  `<button type="button" class="icon-button" data-action="${action}" aria-label="${escape(name)}" title="${escape(name)}" ${extra}>${icon(glyph)}</button>`;
export function toast(message) {
  let node = $("#toast");
  if (!node) {
    node = document.createElement("div");
    node.id = "toast";
    node.role = "status";
    document.body.append(node);
  }
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (node.hidden = true), 6500);
}
export function modal(
  title,
  body,
  {
    submit = "Save",
    onSubmit,
    className = "",
    onClose,
    canDismiss = () => true,
  } = {},
) {
  const d = document.createElement("dialog");
  d.className = className;
  d.setAttribute("aria-label", title);
  d.innerHTML = `<form><header><h2>${escape(title)}</h2><button type="button" class="icon-button" data-dismiss aria-label="Close" title="Close">${icon("close")}</button></header><section class="dialog-body">${body}</section><div class="dialog-error" role="alert"></div>${onSubmit ? `<footer><button type="button" data-dismiss>Cancel</button><button type="submit" class="primary">${escape(submit)}</button></footer>` : ""}</form>`;
  const abort = new AbortController();
  d.operation = abort;
  const dismiss = () => {
    if (!d.dataset.saving && canDismiss()) d.close();
  };
  d.querySelectorAll("[data-dismiss]").forEach((b) => (b.onclick = dismiss));
  d.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (d.dataset.saving) toast("Wait for the save to finish.");
    else dismiss();
  });
  d.addEventListener("click", (event) => {
    const r = d.getBoundingClientRect();
    if (
      event.target === d &&
      !d.dataset.saving &&
      (event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom)
    )
      dismiss();
  });
  d.querySelector("form").onsubmit = async (event) => {
    event.preventDefault();
    if (!onSubmit || d.dataset.saving) return;
    const data = new FormData(event.target);
    d.dataset.saving = "true";
    const controls = [...d.querySelectorAll("input,textarea,select,button")];
    controls.forEach((c) => (c.disabled = true));
    try {
      d.pendingSave = Promise.resolve(onSubmit(data, d, abort.signal));
      await d.pendingSave;
      d.close();
    } catch (e) {
      $(".dialog-error", d).textContent = e.message;
    } finally {
      delete d.dataset.saving;
      controls.forEach((c) => (c.disabled = false));
    }
  };
  d.addEventListener(
    "close",
    () => {
      abort.abort();
      onClose?.(d);
      d.remove();
    },
    { once: true },
  );
  document.body.append(d);
  d.showModal();
  return d;
}
export const field = (label, name, value = "", extra = "") =>
  `<label class="field">${escape(label)}<input name="${name}" value="${escape(value)}" ${extra}></label>`;
export function popover(title, body, { anchor, onChange } = {}) {
  document.querySelector(".settings-popover")?.dismiss?.();
  const d = document.createElement("section");
  d.className = "settings-popover";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-label", title);
  d.innerHTML = `<header><h2>${escape(title)}</h2></header><form>${body}</form><div class="dialog-error" role="alert"></div>`;
  document.body.append(d);
  const r = anchor?.getBoundingClientRect();
  d.style.left =
    Math.max(
      6,
      Math.min(
        r?.left || innerWidth - d.offsetWidth - 12,
        innerWidth - d.offsetWidth - 6,
      ),
    ) + "px";
  d.style.top =
    Math.max(6, Math.min(r?.bottom || 60, innerHeight - d.offsetHeight - 6)) +
    "px";
  const previous = document.activeElement;
  const dismiss = () => {
    d.remove();
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", key);
  };
  const outside = (e) => {
    if (
      !d.contains(e.target) &&
      !anchor?.contains(e.target) &&
      !e.target.closest(".context-menu")
    )
      dismiss();
  };
  const key = (e) => {
    if (e.key === "Escape" && !document.querySelector(".context-menu")) {
      e.preventDefault();
      dismiss();
      previous?.focus();
    }
  };
  d.dismiss = dismiss;
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", key);
  $("form", d).onsubmit = (e) => e.preventDefault();
  const update = (event) =>
    Promise.resolve()
      .then(() => onChange?.(new FormData($("form", d)), event))
      .then(() => ($(".dialog-error", d).textContent = ""))
      .catch((e) => ($(".dialog-error", d).textContent = e.message));
  d.addEventListener("change", update);
  d.addEventListener("input", (e) => {
    if (
      e.target.matches(
        'input:not([type="checkbox"]):not([type="radio"]), textarea',
      )
    )
      update(e);
  });
  return d;
}
export function menu(items, { x, y, anchor } = {}) {
  document.querySelector(".context-menu")?.closeMenu?.();
  const d = document.createElement("div");
  d.className = "context-menu";
  d.role = "menu";
  d.popover = "manual";
  for (const item of items) {
    if (!item) {
      const hr = document.createElement("hr");
      d.append(hr);
      continue;
    }
    const b = document.createElement(item.href ? "a" : "button");
    if (item.href) b.href = item.href;
    else b.type = "button";
    b.role = "menuitem";
    if (item.disabled) {
      b.disabled = true;
      b.setAttribute("aria-disabled", "true");
    }
    b.innerHTML =
      icon(item.icon || "file") + `<span>${escape(item.label)}</span>`;
    b.onclick = () => {
      close();
      if (item.href) return;
      Promise.resolve()
        .then(item.run)
        .catch((e) => toast(e.message));
    };
    d.append(b);
  }
  const previous = anchor ?? document.activeElement;
  (anchor?.closest("dialog[open]") ?? document.body).append(d);
  d.showPopover();
  const rect = anchor?.getBoundingClientRect();
  x ??= rect?.left || 8;
  y ??= rect?.bottom || 8;
  d.style.left =
    Math.max(6, Math.min(x, innerWidth - d.offsetWidth - 6)) + "px";
  d.style.top =
    Math.max(6, Math.min(y, innerHeight - d.offsetHeight - 6)) + "px";
  let listenerTimer;
  function close() {
    clearTimeout(listenerTimer);
    d.remove();
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", key, true);
    previous?.focus({ preventScroll: true });
  }
  d.closeMenu = close;
  function outside(e) {
    if (!d.contains(e.target)) close();
  }
  function key(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      const bs = [...d.querySelectorAll('[role="menuitem"]:not(:disabled)')],
        i = bs.indexOf(document.activeElement);
      bs[
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? bs.length - 1
            : (i + (e.key === "ArrowDown" ? 1 : -1) + bs.length) % bs.length
      ]?.focus();
    }
  }
  listenerTimer = setTimeout(
    () => document.addEventListener("pointerdown", outside),
    0,
  );
  document.addEventListener("keydown", key, true);
  d.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
  return d;
}
