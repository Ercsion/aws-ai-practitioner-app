// Simple offline cache for the AIF-C01 study app (PWA).
var CACHE_NAME = "aif-app-cache-v1";
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
  self.skipWaiting();
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

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (resp) {
        var respClone = resp.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, respClone);
        });
        return resp;
      }).catch(function () { return cached; });
    })
  );
});
