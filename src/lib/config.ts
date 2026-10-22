export const BROUTER_URL = 'https://brouter.de/brouter';
// 'safety' prefers cycleways and quiet roads; alternatives: 'trekking', 'fastbike'.
export const BROUTER_PROFILE = 'safety';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// Turn-by-turn directions: Valhalla matches each routed leg's track to OSM and names its streets.
// FOSSGIS hosts it for fair use only, so directions are fetched on request, one leg at a time, this far apart.
export const VALHALLA_URL = 'https://valhalla1.openstreetmap.de/trace_route';
export const VALHALLA_GAP_MS = 1000;
// Unnamed steps shorter than this (crossings, kerb ramps, short connectors) are folded into the step before.
export const DIRECTIONS_MIN_STEP_M = 40;
// A stretch on another way shorter than this that returns to the way before it is left out of the directions.
export const DIRECTIONS_MAX_DETOUR_M = 400;

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

// BRouter publishes no rate limit, but brouter.de answers 403 when hit too often, so requests go
// one at a time. In a burst (rapid clicks, optimise) the gap between them doubles from
// burstBaseMs up to burstMaxMs; the burst ends after quietMs with no requests. quietMs must exceed
// burstMaxMs. A 403/429 waits rejectBaseMs, doubling up to rejectMaxMs, and is retried maxRetries times.
export const BROUTER_THROTTLE = {
  burstBaseMs: 250,
  burstMaxMs: 2000,
  quietMs: 3000,
  rejectBaseMs: 2000,
  rejectMaxMs: 30000,
  maxRetries: 3,
};

// Routed legs are kept in localStorage for this long, so reopening a route doesn't query BRouter again.
// The age counts from when the leg was fetched, so map data is never more than this stale.
// Bump LEG_CACHE_VERSION whenever parseBRouter/classify change what a cached LegResult means.
export const LEG_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const LEG_CACHE_VERSION = 1;
// Caps the cache well under localStorage's ~5M-character quota, leaving room for saved routes.
export const LEG_CACHE_MAX_CHARS = 1_000_000;

// Google Maps directions links take at most this many stops between origin and destination.
export const MAX_GOOGLE_STOPS = 9;

// Below this width the planner stacks under the map, and it and the legend start folded to leave the map room.
// Keep in step with the max-width media queries in App.svelte and Sidebar.svelte.
export const MOBILE_QUERY = '(max-width: 700px)';
