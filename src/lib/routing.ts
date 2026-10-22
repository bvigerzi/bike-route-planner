import { classify, type Category } from './categories';
import { BROUTER_PROFILE, BROUTER_URL, DIRECT_SPEED_KMH } from './config';

export type LatLng = { lat: number; lng: number };
export type LegMode = 'route' | 'direct';

export interface Segment {
  category: Category;
  coords: [number, number][]; // [lat, lng]
}

export interface LegResult {
  segments: Segment[];
  distanceM: number;
  timeS: number;
  ascentM: number;
}

export function legKey(a: LatLng, b: LatLng, mode: LegMode): string {
  return `${mode}:${a.lat},${a.lng};${b.lat},${b.lng}`;
}

export function haversine(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pathLength(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversine(coords[i - 1], coords[i]);
  return total;
}

/**
 * Convert a BRouter GeoJSON response into category-coloured segments.
 * Each BRouter message row describes the way leading up to its (micro-degree) lon/lat,
 * which coincides with a geometry coordinate.
 */
export function parseBRouter(geojson: any): LegResult {
  const feature = geojson.features[0];
  const props = feature.properties;
  const coords: number[][] = feature.geometry.coordinates;
  const [header, ...rows]: string[][] = props.messages;
  const lonIdx = header.indexOf('Longitude');
  const latIdx = header.indexOf('Latitude');
  const tagIdx = header.indexOf('WayTags');

  const segments: Segment[] = [];
  let current: Segment | null = null;
  let mi = 0;

  for (const [lon, lat] of coords) {
    const row = rows[Math.min(mi, rows.length - 1)];
    const category = row ? classify(row[tagIdx]) : 'road';
    if (!current || current.category !== category) {
      // Start the new segment at the previous segment's last point so the line stays continuous.
      current = { category, coords: current ? [current.coords[current.coords.length - 1]] : [] };
      segments.push(current);
    }
    current.coords.push([lat, lon]);
    if (row && Math.abs(lon * 1e6 - Number(row[lonIdx])) < 2 && Math.abs(lat * 1e6 - Number(row[latIdx])) < 2) {
      mi++;
    }
  }

  return {
    segments,
    distanceM: Number(props['track-length']),
    timeS: Number(props['total-time']),
    ascentM: Number(props['filtered ascend']) || 0,
  };
}

const cache = new Map<string, Promise<LegResult>>();

export function routeLeg(a: LatLng, b: LatLng): Promise<LegResult> {
  const key = legKey(a, b, 'route');
  let pending = cache.get(key);
  if (!pending) {
    const params = new URLSearchParams({
      lonlats: `${a.lng},${a.lat}|${b.lng},${b.lat}`,
      profile: BROUTER_PROFILE,
      alternativeidx: '0',
      format: 'geojson',
    });
    pending = fetch(`${BROUTER_URL}?${params}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.text()).trim() || `BRouter error ${res.status}`);
        return parseBRouter(await res.json());
      })
      .catch((err) => {
        cache.delete(key);
        throw err;
      });
    cache.set(key, pending);
  }
  return pending;
}

export function directLeg(a: LatLng, b: LatLng): LegResult {
  const coords: [number, number][] = [
    [a.lat, a.lng],
    [b.lat, b.lng],
  ];
  const distanceM = haversine(coords[0], coords[1]);
  return {
    segments: [{ category: 'override', coords }],
    distanceM,
    timeS: distanceM / (DIRECT_SPEED_KMH / 3.6),
    ascentM: 0,
  };
}
