import { request } from "./transport.js";
import { appBase } from "../local/app-location.js";

const worker = navigator.serviceWorker;
const active = new Map();
const observer = new IntersectionObserver(
  (entries) => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting) continue;
      observer.unobserve(target);
      const entry = active.get(target);
      void request(target.dataset.thumbnail)
        .then((response) => response.blob())
        .then((blob) => {
          if (active.get(target) !== entry) return;
          entry.url = URL.createObjectURL(blob);
          target.src = entry.url;
        })
        .catch(() => {});
    }
  },
  { rootMargin: "160px" },
);

export function syncThumbnails(host) {
  for (const [img, entry] of active) {
    if (host.contains(img)) continue;
    observer.unobserve(img);
    if (entry.url) URL.revokeObjectURL(entry.url);
    active.delete(img);
  }
  for (const img of host.querySelectorAll("img[data-thumbnail]")) {
    if (active.has(img)) continue;
    active.set(img, {});
    observer.observe(img);
  }
}

export function registerMediaCache() {
  if (import.meta.env.DEV) return;
  const status = document.getElementById("connection-state");
  const ready = () => {
    if (status) status.textContent = "Offline ready";
  };
  if (!worker) return;
  if (worker.controller) ready();
  else {
    if (status) status.textContent = "Preparing offline";
    worker.addEventListener("controllerchange", ready, { once: true });
  }
  void worker
    .register(appBase + "sourcebook-worker.js", {
      type: "module",
      scope: appBase,
    })
    .catch((error) => {
      if (status) status.textContent = "Offline setup failed";
      console.warn("Offline setup failed:", error);
    });
}

export async function clearMediaCache() {
  for (const [img, entry] of active) {
    if (entry.url) URL.revokeObjectURL(entry.url);
    img.removeAttribute("src");
    active.set(img, {});
    observer.observe(img);
  }
}
