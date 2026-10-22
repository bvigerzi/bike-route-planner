import type { LatLng, LegMode } from './routing';

export interface RouteState {
  name: string;
  waypoints: (LatLng & { label?: string })[];
  legModes: LegMode[];
}

/**
 * The route is kept in the URL hash, e.g.
 *   #v=1&n=Sunday%20ride&m=rrd&w=-37.8136,144.9631,Federation%20Square;-37.81,144.97
 * v: format version. n: name. m: one char per leg (r route, d direct), omitted if all are r.
 * w: waypoints joined by ';', each lat,lng[,label]. Name and labels are percent-encoded, so
 * their ',' and ';' can't break the splitting.
 *
 * The hash is never sent to the server, so only the browser limits its length (80 KB+).
 * Each waypoint costs ~20 chars plus its label, so 100 waypoints is ~2 KB. Some apps truncate
 * links past ~2,000 chars when shared (see URL_WARN_LENGTH).
 */
const VERSION = '1';

/** Coordinates are kept to 5 decimal places (~1.1 m). */
export function roundCoord(n: number): number {
  return Math.round(n * 1e5) / 1e5;
}

export function encodeRoute(s: RouteState): string {
  const parts = [`v=${VERSION}`];
  if (s.name) parts.push(`n=${encodeURIComponent(s.name)}`);
  if (s.legModes.includes('direct')) parts.push(`m=${s.legModes.map((m) => (m === 'direct' ? 'd' : 'r')).join('')}`);
  if (s.waypoints.length) {
    const w = s.waypoints.map((p) => {
      const coords = `${roundCoord(p.lat)},${roundCoord(p.lng)}`;
      return p.label ? `${coords},${encodeURIComponent(p.label)}` : coords;
    });
    parts.push(`w=${w.join(';')}`);
  }
  return parts.length > 1 ? parts.join('&') : '';
}

/** Returns null if the hash isn't a route this version understands. */
export function decodeRoute(hash: string): RouteState | null {
  const params = new Map<string, string>();
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  if (params.get('v') !== VERSION) return null;
  try {
    const name = decodeURIComponent(params.get('n') ?? '');
    const w = params.get('w');
    const waypoints: RouteState['waypoints'] = [];
    for (const entry of w ? w.split(';') : []) {
      const [latS, lngS, label, ...rest] = entry.split(',');
      const lat = Number(latS);
      const lng = Number(lngS);
      if (rest.length || !latS || !lngS || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null;
      waypoints.push(label ? { lat, lng, label: decodeURIComponent(label) } : { lat, lng });
    }
    const legs = Math.max(0, waypoints.length - 1);
    const m = params.get('m') ?? '';
    const legModes: LegMode[] =
      m.length === legs && /^[rd]*$/.test(m)
        ? [...m].map((c) => (c === 'd' ? 'direct' : 'route'))
        : Array(legs).fill('route');
    return { name, waypoints, legModes };
  } catch {
    // Malformed percent-encoding.
    return null;
  }
}
