import type { Category } from './categories';
import { DIRECTIONS_MAX_DETOUR_M, DIRECTIONS_MIN_STEP_M, VALHALLA_GAP_MS, VALHALLA_URL } from './config';
import { haversine, legCoords, type LegMode, type LegResult } from './routing';

export type Turn =
  | 'start'
  | 'continue'
  | 'left'
  | 'right'
  | 'slight left'
  | 'slight right'
  | 'sharp left'
  | 'sharp right'
  | 'keep left'
  | 'keep right'
  | 'u-turn'
  | 'roundabout'
  | 'direct';

export interface Step {
  /** How this step begins. */
  turn: Turn;
  /** The street or trail's OSM name, if it has one. */
  name?: string;
  /** Other names for the same way, e.g. a second trail it is part of. */
  also?: string[];
  /** What to call the way when it has no name, e.g. "the shared path". */
  kind: string;
  lengthM: number;
  /** Which roundabout exit to take, for a roundabout step. */
  exit?: number;
}

/** Valhalla maneuver types (valhalla/proto/directions.proto) and the turn each begins with. */
const TURNS: Record<number, Turn> = {
  1: 'start', 2: 'start', 3: 'start',
  7: 'continue', 8: 'continue', 17: 'continue', 22: 'continue', 25: 'continue', 37: 'continue', 38: 'continue',
  9: 'slight right', 10: 'right', 11: 'sharp right', 12: 'u-turn', 13: 'u-turn', 14: 'sharp left', 15: 'left', 16: 'slight left',
  18: 'keep right', 20: 'keep right', 23: 'keep right', 19: 'keep left', 21: 'keep left', 24: 'keep left',
};
const DESTINATION = new Set([4, 5, 6]);
const ROUNDABOUT_ENTER = 26;
const ROUNDABOUT_EXIT = 27;

/** What to call an unnamed way, from the category BRouter's tags put it in. */
const KIND: Record<Category, string> = {
  dedicated: 'the bike path',
  shared: 'the shared path',
  lane: 'the bike lane',
  road: 'the road',
  footpath: 'the footpath',
  override: 'a straight line',
};

/** Google's encoded polyline format, as Valhalla uses it (6 decimal places). Coords are [lat, lng]. */
export function encodePolyline(coords: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let out = '';
  let prevLat = 0;
  let prevLng = 0;
  const encode = (delta: number) => {
    let v = delta < 0 ? ~(delta << 1) : delta << 1;
    let s = '';
    while (v >= 0x20) {
      s += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    return s + String.fromCharCode(v + 63);
  };
  for (const [lat, lng] of coords) {
    const [la, ln] = [Math.round(lat * factor), Math.round(lng * factor)];
    out += encode(la - prevLat) + encode(ln - prevLng);
    [prevLat, prevLng] = [la, ln];
  }
  return out;
}

export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coords: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = () => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    lat += next();
    lng += next();
    coords.push([lat / factor, lng / factor]);
  }
  return coords;
}

// Words that end a trail's name, where Valhalla may run a second name straight on.
const NAME_ENDS = new Set(['Trail', 'Path', 'Track', 'Greenway', 'Bikeway']);

/**
 * Valhalla joins a way's name and the names of the routes along it with spaces, e.g.
 * "Capital City Trail Main Yarra Trail". Split them again after each trail-type word.
 */
export function splitNames(joined: string): string[] {
  const names: string[] = [];
  let current: string[] = [];
  for (const word of joined.split(' ')) {
    current.push(word);
    if (NAME_ENDS.has(word)) names.push(current.splice(0).join(' '));
  }
  // Split only into whole trail names, so "Trail Street" or "Main Path Road" stay as they are.
  return current.length || names.some((n) => !n.includes(' ')) ? [joined] : names;
}

/** The category of the leg's segment nearest to p. */
function categoryAt(p: [number, number], leg: LegResult): Category {
  let best: Category = 'road';
  let bestM = Infinity;
  for (const seg of leg.segments) {
    for (const c of seg.coords) {
      const d = haversine(p, c);
      if (d < bestM) [best, bestM] = [seg.category, d];
    }
  }
  return best;
}

/**
 * Turn a Valhalla trace_route response into steps. Street names come from Valhalla; unnamed ways
 * are described by the BRouter category of the leg at the middle of the step.
 */
export function parseTrace(json: any, leg: LegResult): Step[] {
  const steps: Step[] = [];
  for (const tripLeg of json.trip.legs) {
    const shape = decodePolyline(tripLeg.shape);
    let roundabout: { exit?: number; lengthM: number } | null = null;
    for (const m of tripLeg.maneuvers) {
      if (DESTINATION.has(m.type)) continue;
      const lengthM = m.length * 1000;
      if (m.type === ROUNDABOUT_ENTER) {
        roundabout = { exit: m.roundabout_exit_count, lengthM };
        continue;
      }
      const mid = shape[Math.floor((m.begin_shape_index + m.end_shape_index) / 2)];
      const [name, ...also] = m.street_names?.[0] ? splitNames(m.street_names[0]) : [];
      const step: Step = { turn: TURNS[m.type] ?? 'continue', name, kind: KIND[categoryAt(mid, leg)], lengthM };
      if (also.length) step.also = also;
      if (m.type === ROUNDABOUT_EXIT && roundabout) {
        // One step for the whole roundabout, named after the way it exits onto.
        Object.assign(step, { turn: 'roundabout', exit: roundabout.exit, lengthM: lengthM + roundabout.lengthM });
        roundabout = null;
      }
      steps.push(step);
    }
    if (roundabout) steps.push({ turn: 'roundabout', exit: roundabout.exit, kind: 'the roundabout', lengthM: roundabout.lengthM });
  }
  return steps;
}

const ref = (s: Step) => s.name ?? s.kind;
const names = (s: Step) => (s.name ? [s.name, ...(s.also ?? [])] : []);
const sameWay = (a: Step, b: Step) => ref(a) === ref(b) || names(a).some((n) => names(b).includes(n));

/**
 * Cut the steps down to the ones a rider needs: short unnamed connectors are folded into the step
 * before (or, at the start, the step after), and a step that stays on the same way joins it, even
 * where that way turns. Unnamed ways count as the same when they are the same kind, e.g. two shared paths.
 * A short stretch on another way that comes back to the way before it is left out too.
 */
export function simplify(steps: Step[]): Step[] {
  const out: Step[] = [];
  const isShort = (s: Step) => !s.name && s.lengthM < DIRECTIONS_MIN_STEP_M && s.turn !== 'roundabout' && s.turn !== 'direct';
  const isDetour = (s: Step) => s.lengthM < DIRECTIONS_MAX_DETOUR_M && s.turn !== 'roundabout' && s.turn !== 'direct';
  for (let step of steps) {
    const prev = out.at(-1);
    const before = out.at(-2);
    // Short connectors join the step before them first, so a detour is judged on its full length.
    if (prev && before && !isShort(step) && isDetour(prev) && before.turn !== 'direct' && step.turn !== 'direct' && sameWay(before, step)) {
      out.splice(-2, 2, { ...before, lengthM: before.lengthM + prev.lengthM + step.lengthM });
      continue;
    }
    // A way that shares a name with the one before is the same trail: keep calling it what we did.
    const shared = prev && names(prev).find((n) => names(step).includes(n));
    if (shared) step = { ...step, name: shared, also: undefined };
    if (prev && prev.turn !== 'direct' && step.turn !== 'direct' && (isShort(step) || (step.turn !== 'roundabout' && ref(step) === ref(prev)))) {
      out[out.length - 1] = { ...prev, lengthM: prev.lengthM + step.lengthM };
    } else {
      out.push({ ...step });
    }
  }
  if (out.length > 1 && out[0].turn === 'start' && isShort(out[0]) && out[1].turn !== 'direct') {
    const [first, second] = out.splice(0, 2);
    out.unshift({ ...second, turn: 'start', exit: undefined, lengthM: first.lengthM + second.lengthM });
  }
  return out;
}

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`;
}

const ordinal = (n: number) => {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
};

const TURN_PHRASE: Partial<Record<Turn, string>> = {
  left: 'turn left',
  right: 'turn right',
  'slight left': 'bear left',
  'slight right': 'bear right',
  'sharp left': 'turn sharp left',
  'sharp right': 'turn sharp right',
  'keep left': 'keep left',
  'keep right': 'keep right',
  'u-turn': 'make a U-turn',
};

function clause(s: Step): string {
  const d = formatDistance(s.lengthM);
  switch (s.turn) {
    case 'start':
      return `head along ${ref(s)} for ${d}`;
    case 'continue':
      return `continue onto ${ref(s)} for ${d}`;
    case 'direct':
      return `ride in a straight line (off the mapped route) for ${d}`;
    case 'roundabout':
      return s.exit ? `take the ${ordinal(s.exit)} exit at the roundabout onto ${ref(s)} for ${d}` : `go through the roundabout`;
    default:
      return `${TURN_PHRASE[s.turn]} onto ${ref(s)} and follow it for ${d}`;
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface Places {
  /** Place name of the start, if known. */
  start?: string;
  /** Place name of the end, if known. */
  end?: string;
  /** The route returns to its start. */
  loop: boolean;
}

/** One line per step, e.g. "Start at X and head along Y for 200 m", "Turn left onto Z and follow it for 1.2 km". */
export function narrate(steps: Step[], places: Places): string[] {
  const lines = steps.map(clause);
  if (places.start && lines.length) lines[0] = `start at ${places.start} and ${lines[0]}`;
  lines.push(places.loop ? 'arrive back at the start' : places.end ? `arrive at ${places.end}` : 'arrive at the finish');
  return lines.map(capitalise);
}

const cache = new Map<string, Promise<Step[]>>();
let nextRequestAt = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Steps for one routed leg, from Valhalla. Cached by leg key for the session. */
export function traceLeg(key: string, leg: LegResult): Promise<Step[]> {
  let pending = cache.get(key);
  if (!pending) {
    pending = (async () => {
      const wait = nextRequestAt - Date.now();
      nextRequestAt = Math.max(nextRequestAt, Date.now()) + VALHALLA_GAP_MS;
      if (wait > 0) await sleep(wait);
      // Segments share their end points; drop the repeats.
      const coords = legCoords([leg]).filter((c, i, all) => i === 0 || c[0] !== all[i - 1][0] || c[1] !== all[i - 1][1]);
      const res = await fetch(VALHALLA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encoded_polyline: encodePolyline(coords),
          shape_match: 'map_snap',
          // Pedestrian, not bicycle: BRouter routes over footways the bicycle costing won't match,
          // which cuts the trace short. Only names and turns are used, so the costing doesn't show.
          costing: 'pedestrian',
          directions_options: { units: 'kilometers' },
        }),
      });
      if (res.status === 429) throw new Error('The directions service is busy; try again in a moment');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.trip) throw new Error(json?.error ? `Directions failed: ${json.error}` : `Directions failed (${res.status})`);
      return parseTrace(json, leg);
    })().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, pending);
  }
  return pending;
}

export interface DescribedLeg {
  key: string;
  mode: LegMode;
  result: LegResult;
}

/** A turn-by-turn summary of the whole route. Routed legs are traced one after another. */
export async function describeRoute(legs: DescribedLeg[], places: Places): Promise<string[]> {
  const steps: Step[] = [];
  for (const [i, leg] of legs.entries()) {
    const legSteps =
      leg.mode === 'direct' ? [{ turn: 'direct', kind: KIND.override, lengthM: leg.result.distanceM } satisfies Step] : await traceLeg(leg.key, leg.result);
    // A waypoint isn't a stop: the next leg carries on from it.
    if (i > 0 && legSteps[0]?.turn === 'start') steps.push({ ...legSteps[0], turn: 'continue' }, ...legSteps.slice(1));
    else steps.push(...legSteps);
  }
  return narrate(simplify(steps), places);
}
