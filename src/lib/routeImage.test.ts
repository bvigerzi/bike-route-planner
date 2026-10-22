import { describe, expect, it } from 'vitest';
import { fitView, project } from './routeImage';

describe('project', () => {
  it('maps the world onto one tile at zoom 0', () => {
    expect(project(0, -180, 0)).toEqual([0, 128]);
    expect(project(0, 0, 0)).toEqual([128, 128]);
    expect(project(85.0511287798, 180, 0)[1]).toBeCloseTo(0, 3);
  });
});

describe('fitView', () => {
  const pts: [number, number][] = [
    [-37.8, 144.9],
    [-37.85, 145.0],
  ];

  it('picks the closest zoom that fits within the size limit', () => {
    const v = fitView(pts, 1600, 40, 2);
    expect(v.width).toBeLessThanOrEqual(1600);
    expect(v.height).toBeLessThanOrEqual(1600);
    // One zoom closer would no longer fit.
    const [a, b] = pts.map(([lat, lng]) => project(lat, lng, v.zoom + 1));
    expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])) + 80).toBeGreaterThan(1600);
  });

  it('keeps every point inside the padded image', () => {
    const v = fitView(pts, 1600, 40, 2);
    for (const [lat, lng] of pts) {
      const [x, y] = project(lat, lng, v.zoom);
      expect(x - v.left).toBeGreaterThanOrEqual(39);
      expect(x - v.left).toBeLessThanOrEqual(v.width - 39);
      expect(y - v.top).toBeGreaterThanOrEqual(39);
      expect(y - v.top).toBeLessThanOrEqual(v.height - 39);
    }
  });

  it('limits the aspect ratio of a long, thin route', () => {
    const v = fitView([[-37.8, 144.9], [-37.8, 145.3]], 1600, 40, 2);
    expect(v.width / v.height).toBeLessThanOrEqual(2.01);
  });
});
