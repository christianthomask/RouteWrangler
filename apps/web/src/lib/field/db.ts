'use client';

import type { QueuedAction } from './types';

/**
 * Minimal IndexedDB store for the field capture queue (BUILD_SPEC §7.2). The
 * queue persists across app restarts — a captured read survives a reload or a
 * force-quit until it syncs. No external dependency; raw IndexedDB.
 */
const DB_NAME = 'verameter-field';
const STORE = 'actions';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function putAction(action: QueuedAction): Promise<void> {
  await withStore('readwrite', (s) => s.put(action));
}

export async function allActions(): Promise<QueuedAction[]> {
  const rows = await withStore<QueuedAction[]>('readonly', (s) => s.getAll());
  return rows.sort((a, b) => a.seq - b.seq);
}

export async function deleteAction(id: string): Promise<void> {
  await withStore('readwrite', (s) => s.delete(id));
}
