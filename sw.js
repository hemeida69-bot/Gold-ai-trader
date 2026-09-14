const CACHE_NAME = 'gold-ai-trader-v3';
const SHELL_FILES = [
  './',
  './index.html',
  './analysis.html',
  './styles.css',
  './app.js',
  './data.js',
  './analysis-page.js',
  './smc-engine.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for the app shell (HTML/JS/CSS) so a new deploy is always
// picked up on next load instead of silently serving a stale cached copy —
// this is the exact bug that caused the earlier "still shows old version"
// confusion. Cache is only a fallback for when the network is unavailable.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith('/api/')) return; // never cache market data

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
