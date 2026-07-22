'use client';

import { useEffect, useRef } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { config } from '@/lib/config';
import { boundsOf, padBBox } from '@/lib/field/geo';
import type { MapStop } from './RouteMap';

/**
 * Real-basemap map (ADR-022): MapLibre GL rendering our self-hosted PMTiles
 * vector tiles from R2, with the route + stops drawn as a GeoJSON overlay on
 * top. Client-only (needs WebGL + DOM). Any failure — no WebGL, style/tiles
 * unreachable, or the WebGL context being lost after load — calls onFallback so
 * the wrapper swaps in the SVG plot, which is always available offline.
 */

const TONE_COLOR: Record<MapStop['tone'], string> = {
  done: '#16a34a',
  skipped: '#b45309',
  pending: '#64748b',
};
const BRAND = '#0e7490';

function overlay(stops: MapStop[], currentId?: string, nextId?: string) {
  const located = stops.filter((s) => s.lat != null && s.lng != null);
  const line = {
    type: 'Feature' as const,
    geometry: { type: 'LineString' as const, coordinates: located.map((s) => [s.lng, s.lat]) },
    properties: {},
  };
  const cur = located.find((s) => s.id === currentId);
  const nxt = located.find((s) => s.id === nextId);
  const leg =
    cur && nxt
      ? {
          type: 'Feature' as const,
          geometry: { type: 'LineString' as const, coordinates: [[cur.lng, cur.lat], [nxt.lng, nxt.lat]] },
          properties: {},
        }
      : null;
  const points = {
    type: 'FeatureCollection' as const,
    features: located.map((s) => {
      const isCur = s.id === currentId;
      const isNext = s.id === nextId;
      return {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: {
          id: s.id,
          color: isCur ? BRAND : isNext ? '#ffffff' : TONE_COLOR[s.tone],
          radius: isCur ? 9 : isNext ? 7 : 5,
          stroke: isNext ? BRAND : '#ffffff',
          // "Current", not "You" — this marks the stop being worked, not the
          // reader's own position. Unlabelled stops carry their sequence number
          // so reading order is legible without a GPS fix.
          label: isCur ? 'Current' : isNext ? 'Next' : `#${s.sequence + 1}`,
        },
      };
    }),
  };
  return { line, leg, points };
}

export function BaseMap({
  stops,
  currentId,
  nextId,
  focus = 'route',
  height = 200,
  onSelect,
  onFallback,
}: {
  stops: MapStop[];
  currentId?: string;
  nextId?: string;
  focus?: 'route' | 'current';
  height?: number;
  onSelect?: (id: string) => void;
  onFallback?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const readyRef = useRef(false);
  const onFallbackRef = useRef(onFallback);
  onFallbackRef.current = onFallback;

  // Create the map once.
  useEffect(() => {
    let disposed = false;
    let map: unknown;
    let detachContextLoss: (() => void) | null = null;

    (async () => {
      try {
        const maplibre = (await import('maplibre-gl')).default;
        const { Protocol } = await import('pmtiles');
        // pmtiles:// sources in the style resolve through this protocol.
        const protocol = new Protocol();
        maplibre.addProtocol('pmtiles', protocol.tile);

        if (disposed || !container.current) return;
        const m = new maplibre.Map({
          container: container.current,
          style: config.mapStyleUrl,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
        });
        map = m;
        mapRef.current = m;

        m.on('error', (e: { error?: { message?: string } }) => {
          // A failed style/tile load is unrecoverable for the basemap → fall back.
          if (!readyRef.current) onFallbackRef.current?.();
          void e;
        });
        m.on('load', () => {
          if (disposed) return;
          readyRef.current = true;
          draw(m, maplibre, stops, currentId, nextId, focus, onSelect);
        });

        // WebGL context loss *after* load. The `error` handler above only fires
        // the fallback pre-`load`, so without this a context loss would leave a
        // dead, blank canvas on screen. This is the realistic field case: on a
        // low-memory phone the OS/GPU reclaims the context when the tab is
        // backgrounded or another app demands VRAM. We don't attempt a restore —
        // the SVG plot is always available and always cheap — so treat loss as
        // terminal for the basemap and hand back to the fallback.
        const onContextLost = () => {
          if (disposed) return;
          readyRef.current = false;
          onFallbackRef.current?.();
        };
        m.on('webglcontextlost', onContextLost);
        const canvas: HTMLCanvasElement | undefined = m.getCanvas?.();
        canvas?.addEventListener('webglcontextlost', onContextLost);
        detachContextLoss = () => {
          m.off('webglcontextlost', onContextLost);
          canvas?.removeEventListener('webglcontextlost', onContextLost);
        };
      } catch {
        onFallbackRef.current?.(); // no WebGL / import failure
      }
    })();

    return () => {
      disposed = true;
      readyRef.current = false;
      detachContextLoss?.();
      detachContextLoss = null;
      if (map && typeof (map as { remove?: () => void }).remove === 'function') {
        (map as { remove: () => void }).remove();
      }
      mapRef.current = null;
    };
  }, []);

  // Redraw overlay + recamera when the route/selection changes.
  useEffect(() => {
    const m = mapRef.current;
    if (!m || !readyRef.current) return;
    (async () => {
      const maplibre = (await import('maplibre-gl')).default;
      draw(m, maplibre, stops, currentId, nextId, focus, onSelect);
    })();
  }, [stops, currentId, nextId, focus]);

  return (
    <div
      ref={container}
      style={{ height, width: '100%', borderRadius: 'var(--rw-radius)', overflow: 'hidden', background: 'var(--rw-surface-2)' }}
    />
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function draw(m: any, maplibre: any, stops: MapStop[], currentId: string | undefined, nextId: string | undefined, focus: 'route' | 'current', onSelect?: (id: string) => void) {
  const { line, leg, points } = overlay(stops, currentId, nextId);

  const setData = (id: string, data: unknown, addLayer: () => void) => {
    const src = m.getSource(id);
    if (src) src.setData(data);
    else {
      m.addSource(id, { type: 'geojson', data });
      addLayer();
    }
  };

  setData('route-line', line, () =>
    m.addLayer({ id: 'route-line', type: 'line', source: 'route-line', paint: { 'line-color': '#94a3b8', 'line-width': 3, 'line-opacity': 0.8 }, layout: { 'line-join': 'round', 'line-cap': 'round' } }),
  );
  setData('route-leg', leg ?? { type: 'FeatureCollection', features: [] }, () =>
    m.addLayer({ id: 'route-leg', type: 'line', source: 'route-leg', paint: { 'line-color': BRAND, 'line-width': 3, 'line-dasharray': [1, 2] } }),
  );
  setData('route-stops', points, () => {
    // Circles only — no symbol/text layer, so we never depend on the style
    // shipping a glyphs endpoint. Current (brand, large) and next (white, ringed)
    // are already visually distinct; the surrounding UI names the next stop.
    m.addLayer({ id: 'route-stops', type: 'circle', source: 'route-stops', paint: { 'circle-radius': ['get', 'radius'], 'circle-color': ['get', 'color'], 'circle-stroke-color': ['get', 'stroke'], 'circle-stroke-width': 2 } });
    if (onSelect) {
      m.on('click', 'route-stops', (e: { features?: Array<{ properties?: { id?: string } }> }) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) onSelect(id);
      });
      m.on('mouseenter', 'route-stops', () => (m.getCanvas().style.cursor = 'pointer'));
      m.on('mouseleave', 'route-stops', () => (m.getCanvas().style.cursor = ''));
    }
  });

  const boundsSet =
    focus === 'current' ? stops.filter((s) => s.id === currentId || s.id === nextId) : stops;
  const b = boundsOf(boundsSet.length ? boundsSet : stops);
  if (b) {
    const p = padBBox(b, 0.25);
    m.fitBounds(
      [[p.minLng, p.minLat], [p.maxLng, p.maxLat]],
      { padding: 28, maxZoom: 17, duration: 0 },
    );
  }
  void maplibre;
}
