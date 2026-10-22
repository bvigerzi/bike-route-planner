export const BROUTER_URL = 'https://brouter.de/brouter';
// 'safety' prefers cycleways and quiet roads; alternatives: 'trekking', 'fastbike'.
export const BROUTER_PROFILE = 'safety';

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

// BRouter gives no time for direct (user override) legs, so estimate them at this speed.
export const DIRECT_SPEED_KMH = 15;

export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_SIZE = 256;
// The deepest zoom the OSM tile servers provide.
export const TILE_MAX_ZOOM = 19;

// "Export image" picks the closest zoom at which the route, plus padding, fits within this many pixels each way.
// It is kept modest because every tile in the image is fetched from the OSM tile servers.
export const IMAGE_MAX_PX = 1600;
export const IMAGE_PADDING_PX = 40;
// The image is widened (or heightened) so neither side is more than this many times the other.
export const IMAGE_MAX_ASPECT = 2;
// The image is rendered at this multiple of the layout above, with tiles from a correspondingly deeper zoom,
// so zooming in on it shows more map detail. A power of 2; 2 keeps it within the canvas size iOS Safari allows.
export const IMAGE_SCALE = 2;
// The route line's width (and dash length) in the image, as a multiple of its width on the map. 1 matches the
// map at the image's tile zoom, so it covers as little of the streets as possible; higher stands out more when
// the whole image is viewed at once. The markers and attribution always scale with IMAGE_SCALE.
export const IMAGE_LINE_SCALE = 1.5;

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
