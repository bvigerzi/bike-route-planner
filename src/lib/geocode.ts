import { PHOTON_URL } from './config';

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

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  locality?: string;
  district?: string;
  city?: string;
  state?: string;
  country?: string;
}

interface PhotonFeature {
  properties: PhotonProps;
  geometry: { coordinates: [number, number] };
}

/** A Nominatim-style "most specific first" label, e.g. "Flinders Street, Melbourne, Victoria, Australia". */
export function photonLabel(p: PhotonProps): string {
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const parts = [p.name, street, p.locality, p.district, p.city, p.state, p.country].filter((s): s is string => !!s);
  return parts.filter((s, i) => parts.indexOf(s) === i).join(', ');
}

/** The Photon search URL, biased (not limited) towards the centre of the current map view. */
export function photonUrl(query: string, view?: Viewbox): string {
  const params = new URLSearchParams({ q: query, limit: '5' });
  if (view) {
    params.set('lat', String((view.north + view.south) / 2));
    params.set('lon', String((view.east + view.west) / 2));
    // Photon's zoom sets how far the bias reaches; derive it from the view's width.
    const zoom = Math.log2(360 / Math.max(view.east - view.west, 1e-6));
    params.set('zoom', String(Math.max(0, Math.min(18, Math.round(zoom)))));
  }
  return `${PHOTON_URL}?${params}`;
}

/** Search Photon. Unlike Nominatim it permits search-as-you-type, so this can run on each (debounced) keystroke. */
export async function searchPlaces(query: string, view?: Viewbox, signal?: AbortSignal): Promise<Place[]> {
  const res = await fetch(photonUrl(query, view), { signal });
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const { features }: { features: PhotonFeature[] } = await res.json();
  return features.map((f) => ({
    label: photonLabel(f.properties),
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));
}
