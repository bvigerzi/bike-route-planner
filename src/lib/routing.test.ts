import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directLeg, parseBRouter, parseSnap, pathLength, samePath, type LegResult } from './routing';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/brouter-sample.json', import.meta.url), 'utf8'));

describe('parseBRouter', () => {
  const result = parseBRouter(fixture);
  const coords: number[][] = fixture.features[0].geometry.coordinates;

  it('reads totals from properties', () => {
    expect(result.distanceM).toBe(2129);
    expect(result.timeS).toBe(411);
    expect(result.ascentM).toBe(10);
  });

  it('covers every coordinate in order, with continuous segments', () => {
    const flat = result.segments.flatMap((s, i) => (i === 0 ? s.coords : s.coords.slice(1)));
    expect(flat).toEqual(coords.map(([lon, lat]) => [lat, lon]));
    for (let i = 1; i < result.segments.length; i++) {
      expect(result.segments[i].coords[0]).toEqual(result.segments[i - 1].coords.at(-1));
      expect(result.segments[i].category).not.toBe(result.segments[i - 1].category);
    }
  });

  it('classifies the route sections', () => {
    expect(result.segments.map((s) => s.category)).toEqual(['footpath', 'road', 'shared', 'dedicated', 'shared', 'dedicated', 'road', 'lane', 'road', 'lane', 'dedicated', 'road', 'lane', 'road', 'footpath']);
  });

  it('segment lengths roughly sum to the track length', () => {
    const total = result.segments.reduce((sum, s) => sum + pathLength(s.coords), 0);
    expect(Math.abs(total - result.distanceM)).toBeLessThan(30);
  });
});

describe('directLeg', () => {
  it('builds a straight override segment with a speed-based time', () => {
    const leg = directLeg({ lat: -37.8, lng: 144.9 }, { lat: -37.81, lng: 144.9 });
    expect(leg.segments).toHaveLength(1);
    expect(leg.segments[0].category).toBe('override');
    expect(leg.distanceM).toBeCloseTo(1112, 0);
    expect(leg.timeS).toBeCloseTo(leg.distanceM / (15 / 3.6), 5);
  });
});

describe('samePath', () => {
  const leg = (coords: [number, number][]): LegResult => ({
    segments: [{ category: 'road', coords }],
    distanceM: pathLength(coords),
    timeS: 0,
    ascentM: 0,
  });
  const A: [number, number] = [-37.8, 144.9];
  const B: [number, number] = [-37.805, 144.9];
  const C: [number, number] = [-37.81, 144.9];

  it('treats a route split at a point on its path as the same', () => {
    expect(samePath([leg([A, B]), leg([B, C])], [leg([A, C])], 10)).toBe(true);
  });

  it('detects a detour', () => {
    const off: [number, number] = [-37.805, 144.905];
    expect(samePath([leg([A, off]), leg([off, C])], [leg([A, C])], 10)).toBe(false);
  });

  it('detects a parallel path beyond the tolerance', () => {
    const shift = (p: [number, number]): [number, number] => [p[0], p[1] + 0.0005]; // ~44 m east
    const parallel = leg([A, shift(A), shift(B), shift(C), C]);
    expect(samePath([parallel], [leg([A, C])], 10)).toBe(false);
  });

  it('works on a real BRouter leg', () => {
    const real = parseBRouter(fixture);
    expect(samePath([real], [real], 10)).toBe(true);
  });
});

describe('parseSnap', () => {
  const p = { lat: -37.821, lng: 144.975 };
  // Real BRouter response shape for a zero-length route from p to p.
  const response = (lng: number, lat: number) => ({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: { 'track-length': '0' }, geometry: { type: 'LineString', coordinates: [[lng, lat, 8.5]] } }],
  });

  it('moves to the matched point when it is within range', () => {
    expect(parseSnap(response(144.974743, -37.821135), p, 30)).toEqual({ lat: -37.821135, lng: 144.974743 });
  });

  it('keeps the placed point when the nearest way is too far', () => {
    expect(parseSnap(response(144.8649, -37.925481), p, 30)).toBe(p);
  });

  it('keeps the placed point on an unexpected response', () => {
    expect(parseSnap({}, p, 30)).toBe(p);
    expect(parseSnap({ features: [{ geometry: { coordinates: [] } }] }, p, 30)).toBe(p);
  });
});
