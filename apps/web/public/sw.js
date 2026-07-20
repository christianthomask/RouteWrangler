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
// Basemap tiles + style (ADR-022) live in their own long-lived cache so a shell
// version bump never evicts the offline map a reader pre-warmed for today's run.
const TILES = 'verameter-tiles-v1';
const KEEP = [CACHE, TILES];
const APP_SHELL = ['/field', '/field/tasks', '/manifest.webmanifest', '/icons/icon-192.png'];

const isMapPath = (p) => p.startsWith('/tiles/') || p.startsWith('/map/');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // queue owns writes — never intercept

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // cross-origin API — always network

  // Basemap tiles/style → cache-first into the long-lived tiles cache. This is
  // what makes the map survive offline; the per-route prefetch just pre-populates
  // it by fetching ahead (lib/field/mapCache.ts).
  if (isMapPath(url.pathname)) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => putIfOk(request, res, TILES))),
    );
    return;
  }

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

function putIfOk(request, res, cacheName = CACHE) {
  if (res && res.ok) {
    const copy = res.clone();
    caches.open(cacheName).then((cache) => cache.put(request, copy));
  }
  return res;
}
