import { decodeRoute, encodeRoute } from './routeUrl';
import { legCache, type LegMode, type LegResult } from './routing';

export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

export interface SavedRoute {
  id: string;
  name: string;
  createdAt: string;
  /** The route's URL hash (see routeUrl.ts), without the leading '#'. */
  hash: string;
  /** Kept only for display in the list. */
  distanceM: number;
}

/** Saved routes from before routes were kept in the URL. */
interface LegacySavedRoute {
  id: string;
  name: string;
  createdAt: string;
  waypoints: Waypoint[];
  legModes: LegMode[];
  legs: LegResult[];
}

const KEY = 'brp.routes';

function migrate(r: SavedRoute | LegacySavedRoute): SavedRoute {
  if (!('waypoints' in r)) {
    // Re-encode older link formats, so comparing with the current route's hash still works.
    const state = decodeRoute(r.hash);
    return state ? { ...r, hash: encodeRoute(state) } : r;
  }
  return {
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    hash: encodeRoute({ name: r.name, waypoints: r.waypoints, legModes: r.legModes }),
    distanceM: r.legs.reduce((sum, l) => sum + l.distanceM, 0),
  };
}

export function loadRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw).map(migrate) : [];
  } catch {
    return [];
  }
}

/** Returns false if the write failed (e.g. storage full or unavailable). */
export function saveRoutes(routes: SavedRoute[]): boolean {
  const raw = JSON.stringify(routes);
  try {
    localStorage.setItem(KEY, raw);
    return true;
  } catch {
    // Saved routes matter more than cached legs, so free their space and try again.
    legCache.clear();
    try {
      localStorage.setItem(KEY, raw);
      return true;
    } catch {
      return false;
    }
  }
}
