import { describe, expect, it } from 'vitest';
import { mapsUrl, preferredMapsApp } from './mapsLink';

const points = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: -37.8 + i * 0.01, lng: 144.9 + i * 0.01 }));

describe('mapsUrl', () => {
  it('builds Google Maps cycling directions with every waypoint as a stop, in order', () => {
    const url = new URL(mapsUrl('google', points(4))!);
    expect(url.origin + url.pathname).toBe('https://www.google.com/maps/dir/');
    expect(url.searchParams.get('api')).toBe('1');
    expect(url.searchParams.get('travelmode')).toBe('bicycling');
    expect(url.searchParams.get('origin')).toBe('-37.8,144.9');
    expect(url.searchParams.get('waypoints')).toBe('-37.79,144.91|-37.78,144.92');
    expect(url.searchParams.get('destination')).toBe('-37.77,144.93');
  });

  it('builds Apple Maps cycling directions with a repeated waypoint parameter', () => {
    const url = new URL(mapsUrl('apple', points(4))!);
    expect(url.origin + url.pathname).toBe('https://maps.apple.com/directions');
    expect(url.searchParams.get('mode')).toBe('cycling');
    expect(url.searchParams.get('source')).toBe('-37.8,144.9');
    expect(url.searchParams.getAll('waypoint')).toEqual(['-37.79,144.91', '-37.78,144.92']);
    expect(url.searchParams.get('destination')).toBe('-37.77,144.93');
  });

  it('omits waypoints for a two-point route', () => {
    expect(new URL(mapsUrl('google', points(2))!).searchParams.has('waypoints')).toBe(false);
    expect(new URL(mapsUrl('apple', points(2))!).searchParams.has('waypoint')).toBe(false);
  });

  it('needs at least two points', () => {
    expect(mapsUrl('google', points(1))).toBeNull();
    expect(mapsUrl('apple', [])).toBeNull();
  });

  it("enforces Google's stop limit but not Apple's", () => {
    expect(mapsUrl('google', points(11))).not.toBeNull();
    expect(mapsUrl('google', points(12))).toBeNull();
    expect(new URL(mapsUrl('apple', points(17))!).searchParams.getAll('waypoint')).toHaveLength(15);
  });
});

describe('preferredMapsApp', () => {
  it('picks Apple Maps on iOS and iPadOS, Google Maps elsewhere', () => {
    expect(preferredMapsApp('Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X)', 'iPhone', 5)).toBe('apple');
    expect(preferredMapsApp('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 'iPad', 5)).toBe('apple');
    expect(preferredMapsApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5)).toBe('apple');
    expect(preferredMapsApp('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0)).toBe('google');
    expect(preferredMapsApp('Mozilla/5.0 (Linux; Android 15; Pixel 9)', 'Linux armv8l', 5)).toBe('google');
    expect(preferredMapsApp('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0)).toBe('google');
  });
});
