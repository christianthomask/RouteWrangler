'use client';

import { useEffect, useState } from 'react';
import { useFieldQueue } from '@/lib/field/useFieldQueue';

/**
 * Always-visible sync truth for the field surface (DESIGN_BRIEF §4). Shows
 * online/offline, queued/failed counts, and a manual sync. Color + word — never
 * color alone (ADR-016).
 */
export function SyncIndicator() {
  const { counts, sync } = useFieldQueue();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const queued = counts.pending + counts.syncing;
  let label: string;
  let color: string;
  if (!online) {
    label = queued ? `Offline · ${queued} queued` : 'Offline';
    color = 'var(--rw-sync-pending)';
  } else if (counts.failed) {
    label = `${counts.failed} failed`;
    color = 'var(--rw-sync-failed)';
  } else if (queued) {
    label = `Syncing ${queued}`;
    color = 'var(--rw-sync-syncing)';
  } else {
    label = 'Synced';
    color = 'var(--rw-sync-synced)';
  }

  return (
    <button
      onClick={() => online && sync()}
      title="Sync now"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: 'transparent',
        border: '1px solid var(--rw-border)',
        borderRadius: 'var(--rw-radius-pill)',
        padding: '0.3rem 0.6rem',
        cursor: online ? 'pointer' : 'default',
        fontSize: 'var(--rw-text-xs)',
        fontWeight: 'var(--rw-weight-semibold)',
        color: 'var(--rw-text-secondary)',
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flex: 'none' }} />
      {label}
    </button>
  );
}
