import { CATEGORY_ORDER, type Category } from './categories';
import type { Viewbox } from './geocode';
import { directLeg, legKey, pathLength, routeLeg, type LegMode, type LegResult } from './routing';
import type { SavedRoute, Waypoint } from './storage';

export interface LegState {
  key: string;
  status: 'loading' | 'ok' | 'error';
  result?: LegResult;
  error?: string;
}

class Planner {
  /** Index 0 is the start / meeting point. */
  waypoints = $state<Waypoint[]>([]);
  /** legModes[i] is the mode of the leg from waypoints[i] to waypoints[i + 1]. */
  legModes = $state<LegMode[]>([]);
  legs = $state.raw<LegState[]>([]);
  /** Current map bounds, used to bias place search. */
  view = $state.raw<Viewbox | undefined>(undefined);
  /** Points the map should zoom to; set to request a fit. */
  focus = $state.raw<[number, number][] | null>(null);

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
    this.waypoints.push({ id: crypto.randomUUID(), lat, lng, label });
    if (this.waypoints.length > 1) this.legModes.push('route');
    this.refresh();
  }

  setStart(lat: number, lng: number, label?: string) {
    if (this.waypoints.length === 0) return this.addWaypoint(lat, lng, label);
    this.waypoints[0] = { id: crypto.randomUUID(), lat, lng, label };
    this.refresh();
  }

  moveWaypoint(id: string, lat: number, lng: number) {
    const wp = this.waypoints.find((w) => w.id === id);
    if (!wp) return;
    wp.lat = lat;
    wp.lng = lng;
    wp.label = undefined;
    this.refresh();
  }

  removeWaypoint(id: string) {
    const i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
    this.waypoints.splice(i, 1);
    if (this.legModes.length > 0) this.legModes.splice(Math.max(0, i - 1), 1);
    this.refresh();
  }

  undo() {
    const last = this.waypoints[this.waypoints.length - 1];
    if (last) this.removeWaypoint(last.id);
  }

  clear() {
    this.waypoints = [];
    this.legModes = [];
    this.refresh();
  }

  toggleLeg(i: number) {
    this.legModes[i] = this.legModes[i] === 'route' ? 'direct' : 'route';
    this.refresh();
  }

  load(route: SavedRoute) {
    this.waypoints = $state.snapshot(route.waypoints);
    this.legModes = [...route.legModes];
    this.legs = route.legs.map((result, i) => ({
      key: legKey(route.waypoints[i], route.waypoints[i + 1], route.legModes[i]),
      status: 'ok',
      result,
    }));
    this.focus = route.waypoints.map((w) => [w.lat, w.lng]);
  }

  toSaved(name: string): SavedRoute {
    return {
      id: crypto.randomUUID(),
      name,
      createdAt: new Date().toISOString(),
      waypoints: $state.snapshot(this.waypoints),
      legModes: $state.snapshot(this.legModes),
      legs: this.legs.map((l) => l.result!),
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
      if (prev && prev.status !== 'error') {
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

  private updateLeg(key: string, state: LegState) {
    // Ignore results for legs that have since changed.
    if (this.legs.some((l) => l.key === key)) {
      this.legs = this.legs.map((l) => (l.key === key ? state : l));
    }
  }
}

export const planner = new Planner();
