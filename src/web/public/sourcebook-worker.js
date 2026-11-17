import { receiveShare } from "./share-intake.js";
import { assets, version } from "./precache.js";

const scope = self.registration.scope;
const root = new URL(scope).pathname;
const prefix = "sourcebook-7-shell:" + root + ":";
const name = prefix + version;
const paths = new Set(assets.map((asset) => new URL(asset, scope).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(name)
      .then((cache) =>
        cache.addAll(
          [...paths].map((path) => new Request(path, { cache: "reload" })),
        ),
      ),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(prefix) && key !== name) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(root))
    return;
  if (request.method === "POST" && url.pathname === root + "share-target") {
    event.respondWith(receiveShare(request, scope));
  } else if (request.method === "GET") {
    const path = url.pathname === root ? root + "index.html" : url.pathname;
    if (!paths.has(path)) return;
    event.respondWith(
      (async () =>
        (await (await caches.open(name)).match(path)) ?? fetch(request))(),
    );
  }
});
