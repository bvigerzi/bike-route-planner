import { describe, expect, it } from 'vitest';
import { decodeRoute, encodeRoute, roundCoord, type RouteState } from './routeUrl';
import type { LegMode } from './routing';

const route: RouteState = {
  name: 'Sunday ride & coffee #2, 100% fun; a=b ☕🚲',
  waypoints: [
    { lat: -37.8136, lng: 144.9631, label: 'Federation Square, Melbourne' },
    { lat: -37.81, lng: 144.97 },
    { lat: -37.79, lng: 144.98, label: 'Café; 50% off & more = ok #1' },
  ],
  legModes: ['route', 'direct'],
};

describe('encodeRoute / decodeRoute', () => {
  it('round-trips names, labels and leg modes', () => {
    expect(decodeRoute(encodeRoute(route))).toEqual(route);
    expect(decodeRoute(`#${encodeRoute(route)}`)).toEqual(route);
  });

  it('omits leg modes when every leg is routed', () => {
    const all = encodeRoute({ ...route, legModes: ['route', 'route'] });
    const mixed = encodeRoute(route);
    expect(all.length).toBeLessThan(mixed.length);
    expect(decodeRoute(all)?.legModes).toEqual(['route', 'route']);
  });

  it('round-trips leg modes past one byte of bits', () => {
    const waypoints = Array.from({ length: 20 }, (_, i) => ({ lat: i, lng: -i }));
    const legModes = Array.from({ length: 19 }, (_, i): LegMode => (i % 3 ? 'route' : 'direct'));
    expect(decodeRoute(encodeRoute({ name: '', waypoints, legModes }))?.legModes).toEqual(legModes);
  });

  it('keeps coordinates to 5 decimal places', () => {
    const hash = encodeRoute({ name: '', waypoints: [{ lat: -37.8136049, lng: 144.9 }], legModes: [] });
    expect(decodeRoute(hash)?.waypoints).toEqual([{ lat: -37.8136, lng: 144.9 }]);
    expect(roundCoord(144.123456)).toBe(144.12346);
  });

  it('round-trips extreme coordinates', () => {
    const waypoints = [
      { lat: 90, lng: 180 },
      { lat: -90, lng: -180 },
      { lat: 0, lng: 0 },
      { lat: 0.00001, lng: -0.00001 },
    ];
    expect(decodeRoute(encodeRoute({ name: '', waypoints, legModes: ['route', 'route', 'route'] }))?.waypoints).toEqual(
      waypoints,
    );
  });

  it('uses only URL-safe characters', () => {
    expect(encodeRoute(route)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('encodes an empty route as an empty string', () => {
    expect(encodeRoute({ name: '', waypoints: [], legModes: [] })).toBe('');
    expect(decodeRoute('')).toBeNull();
  });

  it('keeps a name with no waypoints', () => {
    expect(decodeRoute(encodeRoute({ name: 'Plan', waypoints: [], legModes: [] }))).toEqual({
      name: 'Plan',
      waypoints: [],
      legModes: [],
    });
  });

  it('rejects malformed input', () => {
    const hash = encodeRoute(route);
    expect(decodeRoute(hash.slice(0, -2))).toBeNull();
    expect(decodeRoute(`${hash}AA`)).toBeNull();
    expect(decodeRoute(`B${hash.slice(1)}`)).toBeNull(); // Wrong version.
    expect(decodeRoute('A')).toBeNull();
    // Version 2, name of length 1 with an invalid UTF-8 byte.
    expect(decodeRoute('AgH_AA')).toBeNull();
  });

  it('decodes v1 links', () => {
    expect(
      decodeRoute(
        '#v=1&n=Sunday%20ride&m=rd&w=-37.8136,144.9631,Federation%20Square%2C%20Melbourne;-37.81,144.97;-37.79,144.98',
      ),
    ).toEqual({
      name: 'Sunday ride',
      waypoints: [
        { lat: -37.8136, lng: 144.9631, label: 'Federation Square, Melbourne' },
        { lat: -37.81, lng: 144.97 },
        { lat: -37.79, lng: 144.98 },
      ],
      legModes: ['route', 'direct'],
    });
  });

  it('rejects malformed v1 input', () => {
    expect(decodeRoute('v=2&w=1,2')).toBeNull();
    expect(decodeRoute('w=1,2')).toBeNull();
    expect(decodeRoute('v=1&w=abc,2')).toBeNull();
    expect(decodeRoute('v=1&w=91,2')).toBeNull();
    expect(decodeRoute('v=1&w=1,181')).toBeNull();
    expect(decodeRoute('v=1&w=1')).toBeNull();
    expect(decodeRoute('v=1&w=1,2,a,b')).toBeNull();
    expect(decodeRoute('v=1&w=1,2,%E0%A4%A')).toBeNull();
  });

  it('defaults to routed legs when the modes do not match the waypoints', () => {
    expect(decodeRoute('v=1&m=d&w=1,2;3,4;5,6')?.legModes).toEqual(['route', 'route']);
    expect(decodeRoute('v=1&m=rx&w=1,2;3,4;5,6')?.legModes).toEqual(['route', 'route']);
  });

  it('stays under 1 KB for 100 waypoints', () => {
    const waypoints = Array.from({ length: 100 }, (_, i) => ({ lat: -37.81234 + i * 0.001, lng: 144.96789 + i * 0.001 }));
    const length = encodeRoute({ name: 'Long ride', waypoints, legModes: Array(99).fill('route') }).length;
    expect(length).toBeLessThan(1000);
  });
});
