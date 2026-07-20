'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { fieldQueue } from './queue';

/** Live view of the offline queue for field components. */
export function useFieldQueue() {
  useEffect(() => {
    void fieldQueue.load();
  }, []);

  useSyncExternalStore(fieldQueue.subscribe, fieldQueue.getVersion, () => 0);

  return {
    counts: fieldQueue.counts(),
    actions: fieldQueue.snapshot(),
    sync: () => fieldQueue.sync(),
    enqueueRead: fieldQueue.enqueueRead.bind(fieldQueue),
    enqueueSkip: fieldQueue.enqueueSkip.bind(fieldQueue),
  };
}
