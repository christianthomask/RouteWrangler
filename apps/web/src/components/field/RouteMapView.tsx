'use client';

import { useState } from 'react';
import { basemapConfigured } from '@/lib/config';
import { RouteMap, type MapStop } from './RouteMap';
import { BaseMap } from './BaseMap';

export interface RouteMapViewProps {
  stops: MapStop[];
  currentId?: string;
  nextId?: string;
  focus?: 'route' | 'current';
  height?: number;
  onSelect?: (id: string) => void;
}

/**
 * The map the field screens render. Uses the real MapLibre basemap when tiles
 * are configured (ADR-022); otherwise — or if the basemap fails to load — falls
 * back to the always-available offline SVG plot (ADR-021). Same props either way.
 */
export function RouteMapView(props: RouteMapViewProps) {
  const [failed, setFailed] = useState(false);
  if (!basemapConfigured || failed) return <RouteMap {...props} />;
  return <BaseMap {...props} onFallback={() => setFailed(true)} />;
}
