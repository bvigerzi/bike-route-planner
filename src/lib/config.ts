export const BROUTER_URL = 'https://brouter.de/brouter';
// 'safety' prefers cycleways and quiet roads; alternatives: 'trekking', 'fastbike'.
export const BROUTER_PROFILE = 'safety';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// BRouter gives no time for direct (user override) legs, so estimate them at this speed.
export const DIRECT_SPEED_KMH = 15;

export const DEFAULT_CENTER: [number, number] = [-37.8136, 144.9631]; // Melbourne
export const DEFAULT_ZOOM = 13;

// "Optimise route" drops a waypoint if the route without it stays within this many metres of the original.
export const OPTIMISE_TOLERANCE_M = 10;

// New waypoints move onto the nearest rideable way if it is within this many metres; otherwise they stay where placed.
export const SNAP_RADIUS_M = 30;

// Warn when the route's link is longer than this; some apps truncate long links when shared.
export const URL_WARN_LENGTH = 2000;
