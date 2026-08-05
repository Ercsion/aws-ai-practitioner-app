// Offline cache for the AIF-C01 study app (PWA), with an explicit
// update-prompt flow instead of silently auto-activating new versions.
var CACHE_NAME = "aif-app-cache-v17";
var ASSETS = [
  "./index.html",
  "./style.css",
  "./app.js",
  "./questions-data.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS);
    })
  );
  // Intentionally do NOT call skipWaiting() here. The new service worker
  // stays in the "waiting" state until the page explicitly asks it to
  // activate (see the message listener below), so we can prompt the user
  // first via the "new version available" banner in app.js.
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Network-first for same-origin app files so online users always get the
// latest content; falls back to the cached copy when offline.
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request).then(function (resp) {
      var respClone = resp.clone();
      caches.open(CACHE_NAME).then(function (cache) {
        cache.put(event.request, respClone);
      });
      return resp;
    }).catch(function () {
      return caches.match(event.request);
    })
  );
});
