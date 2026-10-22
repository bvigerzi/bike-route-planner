import { describe, expect, it } from 'vitest';
import { toGpx } from './gpx';
import { directLeg, type LegResult } from './routing';

const a = { lat: -37.8, lng: 144.9, label: 'Café & <bar>' };
const b = { lat: -37.81, lng: 144.91 };
const c = { lat: -37.82, lng: 144.9 };
const routed: LegResult = {
  segments: [
    { category: 'road', coords: [[-37.8, 144.9], [-37.805, 144.905]] },
    { category: 'lane', coords: [[-37.805, 144.905], [-37.81, 144.91]] },
  ],
  distanceM: 1400,
  timeS: 300,
  ascentM: 5,
};

describe('toGpx', () => {
  const gpx = toGpx('Sunday "ride"', [a, b, c], [routed, directLeg(b, c)]);

  it('lists waypoints in order, named by label or position', () => {
    expect([...gpx.matchAll(/<wpt lat="([^"]+)" lon="([^"]+)"><name>([^<]*)<\/name>/g)].map((m) => m.slice(1))).toEqual([
      ['-37.8', '144.9', 'Café &amp; &lt;bar&gt;'],
      ['-37.81', '144.91', 'Stop 1'],
      ['-37.82', '144.9', 'Stop 2'],
    ]);
  });

  it('prefers a waypoint name over its label', () => {
    expect(toGpx('', [{ ...a, name: 'Bakery' }, b], [routed])).toContain('<name>Bakery</name>');
  });

  it('joins every leg into one track without repeating shared points', () => {
    expect([...gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)"\/>/g)].map((m) => [Number(m[1]), Number(m[2])])).toEqual([
      [-37.8, 144.9],
      [-37.805, 144.905],
      [-37.81, 144.91],
      [-37.82, 144.9],
    ]);
  });

  it('escapes the name', () => {
    expect(gpx).toContain('<metadata><name>Sunday &quot;ride&quot;</name></metadata>');
    expect(toGpx('', [a, b], [routed])).toContain('<metadata><name>Route</name></metadata>');
  });
});
