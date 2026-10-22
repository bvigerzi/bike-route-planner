import { CATEGORY_ORDER, type Category } from './categories';
import type { Viewbox } from './geocode';
import { OPTIMISE_TOLERANCE_M, SNAP_RADIUS_M } from './config';
import { roundCoord, type RouteState } from './routeUrl';
import { directLeg, legKey, pathLength, routeLeg, samePath, snapToPath, type LatLng, type LegMode, type LegResult } from './routing';
import type { Waypoint } from './storage';

export interface LegState {
  key: string;
  status: 'loading' | 'ok' | 'error';
  result?: LegResult;
  error?: string;
}

class Planner {
  name = $state('');
  /** Index 0 is the start / meeting point. */
  waypoints = $state<Waypoint[]>([]);
  /** legModes[i] is the mode of the leg from waypoints[i] to waypoints[i + 1]. */
  legModes = $state<LegMode[]>([]);
  legs = $state.raw<LegState[]>([]);
  /** Current map bounds, used to bias place search. */
  view = $state.raw<Viewbox | undefined>(undefined);
  /** Points the map should zoom to; set to request a fit. */
  focus = $state.raw<[number, number][] | null>(null);
  /** True while optimise() is running. */
  optimising = $state(false);
  /** Waypoints waiting to snap onto a path, by id, with the position the snap was requested for. */
  private snapping = new Map<string, LatLng>();

  totals = $derived.by(() => {
    const byCategory = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0])) as Record<Category, number>;
    let distanceM = 0;
    let timeS = 0;
    let ascentM = 0;
    for (const leg of this.legs) {
      if (!leg.result) continue;
      distanceM += leg.result.distanceM;
      timeS += leg.result.timeS;
      ascentM += leg.result.ascentM;
      for (const seg of leg.result.segments) byCategory[seg.category] += pathLength(seg.coords);
    }
    return {
      distanceM,
      timeS,
      ascentM,
      byCategory,
      loading: this.legs.some((l) => l.status === 'loading'),
      complete: this.legs.length > 0 && this.legs.every((l) => l.status === 'ok'),
    };
  });

  addWaypoint(lat: number, lng: number, label?: string) {
    [lat, lng] = [roundCoord(lat), roundCoord(lng)];
    const id = crypto.randomUUID();
    this.waypoints.push({ id, lat, lng, label });
    if (this.waypoints.length > 1) this.legModes.push('route');
    this.snap(id, { lat, lng });
  }

  setStart(lat: number, lng: number, label?: string) {
    if (this.waypoints.length === 0) return this.addWaypoint(lat, lng, label);
    [lat, lng] = [roundCoord(lat), roundCoord(lng)];
    const id = crypto.randomUUID();
    this.snapping.delete(this.waypoints[0].id);
    this.waypoints[0] = { id, lat, lng, label };
    this.snap(id, { lat, lng });
  }

  moveWaypoint(id: string, lat: number, lng: number) {
    const wp = this.waypoints.find((w) => w.id === id);
    if (!wp) return;
    [lat, lng] = [roundCoord(lat), roundCoord(lng)];
    wp.lat = lat;
    wp.lng = lng;
    wp.label = undefined;
    this.snap(id, { lat, lng });
  }

  removeWaypoint(id: string) {
    const i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
    this.snapping.delete(id);
    this.waypoints.splice(i, 1);
    if (this.legModes.length > 0) this.legModes.splice(Math.max(0, i - 1), 1);
    this.refresh();
  }

  undo() {
    const last = this.waypoints[this.waypoints.length - 1];
    if (last) this.removeWaypoint(last.id);
  }

  clear() {
    this.name = '';
    this.waypoints = [];
    this.legModes = [];
    this.snapping.clear();
    this.refresh();
  }

  /**
   * Remove waypoints that don't change the route. Each intermediate waypoint between two
   * routed legs is tried in turn: if routing straight from its neighbour before to its
   * neighbour after follows the same path, it is dropped; otherwise it is kept.
   * Returns the number of waypoints removed.
   */
  async optimise(): Promise<number> {
    if (this.optimising) return 0;
    this.optimising = true;
    let removed = 0;
    try {
      let i = 1;
      while (i < this.waypoints.length - 1) {
        const [prev, wp, next] = [i - 1, i, i + 1].map((j) => $state.snapshot(this.waypoints[j]));
        if (this.legModes[i - 1] !== 'route' || this.legModes[i] !== 'route') {
          i++;
          continue;
        }
        let same = false;
        try {
          const [withWp, withoutWp] = await Promise.all([
            Promise.all([routeLeg(prev, wp), routeLeg(wp, next)]),
            routeLeg(prev, next),
          ]);
          same = samePath(withWp, [withoutWp], OPTIMISE_TOLERANCE_M);
        } catch {
          // Routing failed: keep the waypoint.
        }
        // Stop if the route was edited (or a waypoint snapped) while we were waiting on the router.
        if (
          [prev, wp, next].some((w, k) => {
            const now = this.waypoints[i - 1 + k];
            return now?.id !== w.id || now.lat !== w.lat || now.lng !== w.lng;
          })
        ) {
          break;
        }
        if (same) {
          this.removeWaypoint(wp.id);
          removed++;
        } else {
          i++;
        }
      }
    } finally {
      this.optimising = false;
    }
    return removed;
  }

  toggleLeg(i: number) {
    this.legModes[i] = this.legModes[i] === 'route' ? 'direct' : 'route';
    this.refresh();
  }

  /** Replace the route. Its points are taken as already snapped. */
  load(state: RouteState) {
    this.snapping.clear();
    this.name = state.name;
    this.waypoints = state.waypoints.map(({ lat, lng, label }) => ({ id: crypto.randomUUID(), lat, lng, label }));
    this.legModes = [...state.legModes];
    this.refresh();
    if (state.waypoints.length) this.focus = state.waypoints.map((w) => [w.lat, w.lng]);
  }

  toState(): RouteState {
    return {
      name: this.name,
      waypoints: this.waypoints.map(({ lat, lng, label }) => ({ lat, lng, label })),
      legModes: $state.snapshot(this.legModes),
    };
  }

  /** Rebuild legs from waypoints, reusing unchanged legs and routing only new ones. */
  private refresh() {
    const existing = new Map(this.legs.map((l) => [l.key, l]));
    const next: LegState[] = [];
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = $state.snapshot(this.waypoints[i]);
      const b = $state.snapshot(this.waypoints[i + 1]);
      const mode = this.legModes[i];
      const key = legKey(a, b, mode);
      const prev = existing.get(key);
      if (this.snapping.has(a.id) || this.snapping.has(b.id)) {
        // Wait for the snapped position rather than routing from where the point was placed.
        // The key is distinct so the leg is routed once the snap lands, even if the point didn't move.
        next.push({ key: `snapping:${key}`, status: 'loading' });
      } else if (prev && prev.status !== 'error') {
        next.push(prev);
      } else if (mode === 'direct') {
        next.push({ key, status: 'ok', result: directLeg(a, b) });
      } else {
        next.push({ key, status: 'loading' });
        routeLeg(a, b).then(
          (result) => this.updateLeg(key, { key, status: 'ok', result }),
          (err: Error) => this.updateLeg(key, { key, status: 'error', error: err.message }),
        );
      }
    }
    this.legs = next;
  }

  /** Move a waypoint onto the nearest rideable way, if one is close, then reroute. */
  private snap(id: string, requested: LatLng) {
    this.snapping.set(id, requested);
    this.refresh();
    snapToPath(requested, SNAP_RADIUS_M).then((p) => {
      // Ignore if the waypoint was moved or removed since.
      if (this.snapping.get(id) !== requested) return;
      this.snapping.delete(id);
      const wp = this.waypoints.find((w) => w.id === id);
      if (wp) {
        wp.lat = roundCoord(p.lat);
        wp.lng = roundCoord(p.lng);
      }
      this.refresh();
    });
  }

  private updateLeg(key: string, state: LegState) {
    // Ignore results for legs that have since changed.
    if (this.legs.some((l) => l.key === key)) {
      this.legs = this.legs.map((l) => (l.key === key ? state : l));
    }
  }
}

export const planner = new Planner();
