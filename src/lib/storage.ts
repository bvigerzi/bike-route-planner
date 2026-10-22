import type { LegMode, LegResult } from './routing';

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
  waypoints: Waypoint[];
  legModes: LegMode[];
  legs: LegResult[];
}

const KEY = 'brp.routes';

export function loadRoutes(): SavedRoute[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** Returns false if the write failed (e.g. storage full or unavailable). */
export function saveRoutes(routes: SavedRoute[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(routes));
    return true;
  } catch {
    return false;
  }
}
