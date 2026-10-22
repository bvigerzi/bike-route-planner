import { NOMINATIM_URL } from './config';

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

export interface Viewbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Search Nominatim, biased (not limited) to the current map view. Call on submit only, per usage policy. */
export async function searchPlaces(query: string, view?: Viewbox): Promise<Place[]> {
  const params = new URLSearchParams({ q: query, format: 'json', limit: '5' });
  if (view) params.set('viewbox', `${view.west},${view.north},${view.east},${view.south}`);
  const res = await fetch(`${NOMINATIM_URL}?${params}`);
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const results: { display_name: string; lat: string; lon: string }[] = await res.json();
  return results.map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}
