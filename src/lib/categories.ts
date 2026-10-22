export type Category = 'dedicated' | 'shared' | 'lane' | 'road' | 'footpath' | 'override';

export const CATEGORIES: Record<Category, { label: string; color: string; dashed?: boolean }> = {
  dedicated: { label: 'Dedicated bike path', color: '#1b7837' },
  shared: { label: 'Shared path', color: '#7fbf3f' },
  lane: { label: 'Road with bike lane', color: '#2c7fb8' },
  road: { label: 'Road', color: '#777777' },
  footpath: { label: 'Footpath (no bike access)', color: '#f28e2b' },
  override: { label: 'Direct (your override)', color: '#8e44ad', dashed: true },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as Category[];

const PATH_HIGHWAYS = new Set(['path', 'footway', 'pedestrian', 'bridleway', 'steps', 'corridor']);
const BIKE_ALLOWED = new Set(['designated', 'yes', 'permissive']);
const FOOT_ALLOWED = new Set(['designated', 'yes', 'permissive']);
const LANE_VALUES = new Set(['lane', 'track', 'opposite_lane', 'opposite_track']);

/** Parse BRouter's space-separated "key=value" WayTags string. */
export function parseTags(wayTags: string): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const pair of wayTags.split(' ')) {
    const eq = pair.indexOf('=');
    if (eq > 0) tags[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return tags;
}

/** Classify an OSM way (from BRouter WayTags) into a display category. */
export function classify(wayTags: string): Category {
  const t = parseTags(wayTags);
  const hw = t.highway;

  if (t.bicycle === 'no') return 'footpath';

  if (hw === 'cycleway') {
    const shared = FOOT_ALLOWED.has(t.foot) && t.segregated !== 'yes';
    return shared ? 'shared' : 'dedicated';
  }

  if (PATH_HIGHWAYS.has(hw)) {
    if (hw === 'steps' || !BIKE_ALLOWED.has(t.bicycle)) return 'footpath';
    if (t.bicycle === 'designated' && t.foot === 'no') return 'dedicated';
    return 'shared';
  }

  const hasLane = Object.entries(t).some(([k, v]) => k.startsWith('cycleway') && LANE_VALUES.has(v));
  return hasLane ? 'lane' : 'road';
}
