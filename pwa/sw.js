/* Service worker: offline cache, network-first so updates arrive automatically. */
const CACHE = "komukolko-v1";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  // Never intercept the Google Apps Script sync calls
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(
    // cache:"no-cache" = always revalidate with the server (fast ETag check),
    // so a pushed update is picked up on the very next launch
    fetch(e.request, { cache: "no-cache" })
      .then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return r;
      })
      .catch(() => caches.match(e.request).then(m => m || caches.match("./index.html")))
  );
});
