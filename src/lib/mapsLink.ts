import { MAX_GOOGLE_STOPS } from './config';
import { roundCoord } from './routeUrl';
import type { LatLng } from './routing';

export type MapsApp = 'google' | 'apple';

export const MAPS_APP_NAME: Record<MapsApp, string> = { google: 'Google Maps', apple: 'Apple Maps' };

/** Stops allowed between origin and destination. Apple documents no limit. */
export const MAX_STOPS: Record<MapsApp, number> = { google: MAX_GOOGLE_STOPS, apple: Infinity };

/**
 * Apple Maps on iOS / iPadOS (whose links the OS may hand to the user's default navigation
 * app), otherwise Google Maps, whose links open its app on Android and a browser tab on desktop.
 */
export function preferredMapsApp(
  ua = navigator.userAgent,
  platform = navigator.platform,
  touchPoints = navigator.maxTouchPoints,
): MapsApp {
  // iPadOS reports itself as a Mac; only the touch screen gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1) ? 'apple' : 'google';
}

/**
 * Cycling directions through every waypoint, each as a stop, in the given app.
 * Coordinates rather than labels, so the app can't geocode a label somewhere else.
 * Returns null for fewer than two points or more stops than the app allows.
 */
export function mapsUrl(app: MapsApp, waypoints: LatLng[]): string | null {
  if (waypoints.length < 2 || waypoints.length - 2 > MAX_STOPS[app]) return null;
  const [origin, ...rest] = waypoints.map((p) => `${roundCoord(p.lat)},${roundCoord(p.lng)}`);
  const destination = rest.pop()!;
  if (app === 'google') {
    const params = new URLSearchParams({ api: '1', origin, destination, travelmode: 'bicycling' });
    if (rest.length) params.set('waypoints', rest.join('|'));
    return `https://www.google.com/maps/dir/?${params}`;
  }
  const params = new URLSearchParams({ source: origin, destination, mode: 'cycling' });
  for (const stop of rest) params.append('waypoint', stop);
  return `https://maps.apple.com/directions?${params}`;
}
