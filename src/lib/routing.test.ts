import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directLeg, parseBRouter, pathLength } from './routing';

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
