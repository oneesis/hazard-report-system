const CACHE_NAME = "onesap-cache-v1";
const ASSETS_TO_CACHE = [
  "./",
  "./index-home.html",
  "./index.html",
  "./inspection.html",
  "./inspection-form.html",
  "./dashboard.html",
  "./login.html",
  "./style.css",
  "./home.css",
  "./dashboard.css",
  "./login.css",
  "./script.js",
  "./inspection-form.js",
  "./dashboard.js",
  "./login.js",
  "./auth.js",
  "./notifications.js",
  "./reports-utils.js",
  "./offline-sync.js",
  "./manifest.json",
  "./assets/Logo EBL.png",
  "./assets/Logo Hasnur.png",
  "./assets/Nilai Inti - Indonesia.png",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"
];

// Install Event
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("Caching essential assets...");
      return cache.addAll(ASSETS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// Activate Event
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log("Clearing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event (Network-First Fallback to Cache for pages, Cache-First for static assets)
self.addEventListener("fetch", (event) => {
  // Skip non-GET, cross-origin, or Apps Script API POST calls
  if (event.request.method !== "GET" || event.request.url.includes("exec")) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // If successful and normal GET, cache the clone
        if (response && response.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: serve from cache
        return caches.match(event.request);
      })
  );
});
