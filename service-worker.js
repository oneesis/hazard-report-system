const CACHE_NAME = "onesap-cache-v13";
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
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css",
  "https://cdn.jsdelivr.net/npm/chart.js",
  "https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"
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

// [PUSH-START] — Hapus blok ini untuk menonaktifkan push notifications
self.addEventListener('push', event => {
  if (!event.data) return;
  let payload = {};
  try { payload = event.data.json(); } catch { payload = { title: 'ONE-SAP', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'ONE-SAP', {
      body: payload.body || '',
      icon: './assets/Logo EBL.png',
      badge: './assets/Logo EBL.png',
      data: { url: payload.url || 'https://sap-ebl.vercel.app/index-home.html' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || 'https://sap-ebl.vercel.app/index-home.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const existing = list.find(c => c.url.includes('sap-ebl') && 'focus' in c);
      if (existing) { existing.focus(); existing.postMessage({ type: 'navigate', url }); }
      else return clients.openWindow(url);
    })
  );
});
// [PUSH-END]
