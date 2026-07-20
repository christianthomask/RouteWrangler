import { describe, expect, it } from 'vitest';
import { boundsOf, latToTileY, lngToTileX, padBBox, tilesForBBox } from './geo';

describe('geo helpers', () => {
  it('boundsOf ignores stops without coordinates', () => {
    const b = boundsOf([
      { lat: 35.2, lng: -120.7 },
      { lat: null, lng: null },
      { lat: 35.3, lng: -120.6 },
    ]);
    expect(b).toEqual({ minLng: -120.7, minLat: 35.2, maxLng: -120.6, maxLat: 35.3 });
  });

  it('boundsOf returns null when nothing is located', () => {
    expect(boundsOf([{ lat: null, lng: null }])).toBeNull();
  });

  it('padBBox expands a single point into a real area', () => {
    const b = padBBox({ minLng: -120.66, minLat: 35.28, maxLng: -120.66, maxLat: 35.28 });
    expect(b.maxLng).toBeGreaterThan(b.minLng);
    expect(b.maxLat).toBeGreaterThan(b.minLat);
  });

  it('slippy tile math matches known OSM values', () => {
    // San Luis Obispo ~ (35.2828, -120.6596) at z=14 → x=2700, y=6473
    expect(lngToTileX(-120.6596, 14)).toBe(2700);
    expect(latToTileY(35.2828, 14)).toBe(6473);
  });

  it('tilesForBBox covers the box and respects the cap', () => {
    const b = { minLng: -120.7, minLat: 35.27, maxLng: -120.6, maxLat: 35.32 };
    const tiles = tilesForBBox(b, 12, 15);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.every((t) => t.z >= 12 && t.z <= 15)).toBe(true);
    expect(tilesForBBox(b, 12, 18, 50)).toHaveLength(50); // cap honored
  });
})
