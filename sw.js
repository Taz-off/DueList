const CACHE_NAME = "duelist-static-v15";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./src/styles/main.css?v=15",
  "./src/app/main.js?v=15",
  "./src/data/database.js?v=15",
  "./src/styles/main.css",
  "./src/app/main.js",
  "./src/data/database.js",
  "./manifest.webmanifest",
  "./public/assets/logos/logo-light.png",
  "./public/assets/logos/logo-dark.png",
  "./public/icons/icon-192.png",
  "./public/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName))
        );
      })
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(fetchAndCache(event.request));
});

async function fetchAndCache(request) {
  try {
    const networkResponse = await fetch(request);
    const responseCopy = networkResponse.clone();
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, responseCopy);
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    if (request.mode === "navigate") {
      return caches.match("./index.html");
    }

    throw error;
  }
}
