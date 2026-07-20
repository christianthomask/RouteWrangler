'use client';

import { useEffect } from 'react';

/**
 * Registers the field service worker (app-shell offline only). Kept out of the
 * console: only field readers install the PWA. Registration failures are
 * non-fatal — the app works online without it, and the queue's offline
 * guarantees live in IndexedDB, not the SW.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return; // dev has no stable SW asset
    navigator.serviceWorker.register('/sw.js', { scope: '/field' }).catch(() => {});
  }, []);
  return null;
}
