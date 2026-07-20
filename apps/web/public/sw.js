/*
 * Verameter field service worker.
 *
 * Scope is deliberately narrow: this SW only makes the *app shell* available
 * offline so the reader can launch the installed PWA with no signal and reach
 * the capture screens. It never caches API responses and never touches
 * non-GET requests — the read/skip queue is owned entirely by the IndexedDB
 * store-and-forward engine (lib/field/queue.ts), which is the single source of
 * exactly-once delivery. Caching POSTs here would create a second, competing
 * delivery path and break that guarantee.
 */
const CACHE = 'verameter-shell-v1';
const APP_SHELL = ['/field', '/field/tasks', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // queue owns writes — never intercept

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin API — always network

  const isShell = url.pathname.startsWith('/field') || request.mode === 'navigate';
  const isAsset = url.pathname.startsWith('/_next/static') || url.pathname.startsWith('/icons');
  if (!isShell && !isAsset) return;

  if (isAsset) {
    // Hashed static assets are immutable → cache-first.
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => putIfOk(request, res))),
    );
    return;
  }

  // App shell → network-first, fall back to cache when offline.
  event.respondWith(
    fetch(request)
      .then((res) => putIfOk(request, res))
      .catch(() => caches.match(request).then((hit) => hit || caches.match('/field'))),
  );
});

function putIfOk(request, res) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy));
  }
  return res;
}
