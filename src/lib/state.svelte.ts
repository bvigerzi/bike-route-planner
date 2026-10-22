import { CATEGORY_ORDER, type Category } from './categories';
import type { Viewbox } from './geocode';
import { NAME_ALLOWED_RADIUS_M, OPTIMISE_TOLERANCE_M, SNAP_RADIUS_M, UNDO_LIMIT } from './config';
import { roundCoord, type RouteState } from './routeUrl';
import { directLeg, haversine, legKey, pathLength, routeLeg, samePath, snapToPath, type LatLng, type LegMode, type LegResult } from './routing';
import type { Waypoint } from './storage';

export interface LegState {
  key: string;
  status: 'loading' | 'ok' | 'error';
  result?: LegResult;
  error?: string;
}

/** The route as it was before an edit, for undo. */
interface Snapshot {
  waypoints: Waypoint[];
  legModes: LegMode[];
  loop: boolean;
  /** Waypoints that were still waiting to snap, with the position requested. */
  snapping: [string, LatLng][];
  /** Set by edits that replace the whole route (clear, load), which also change these. */
  doc?: { name: string; savedId: string | null };
}

class Planner {
  name = $state('');
  /** Id of the saved route being edited, if the route was loaded from (or saved to) the saved list. */
  savedId = $state<string | null>(null);
  /** Index 0 is the start / meeting point. */
  waypoints = $state<Waypoint[]>([]);
  /** True when the route returns to the start: the last waypoint then mirrors the first. */
  loop = $state(false);
  /** legModes[i] is the mode of the leg from waypoints[i] to waypoints[i + 1]. */
  legModes = $state<LegMode[]>([]);
  legs = $state.raw<LegState[]>([]);
  /** Current map bounds, used to bias place search. */
  view = $state.raw<Viewbox | undefined>(undefined);
  /** Points the map should zoom to; set to request a fit. */
  focus = $state.raw<[number, number][] | null>(null);
  /** True while optimise() is running. */
  optimising = $state(false);
  /** A short message to flash to the user; a new object each time, so repeats show again. */
  notice = $state.raw<{ text: string } | null>(null);
  /** Waypoints waiting to snap onto a path, by id, with the position the snap was requested for. */
  private snapping = new Map<string, LatLng>();
  /** Earlier states of the route, most recent last. */
  private history = $state.raw<Snapshot[]>([]);

  canUndo = $derived(this.history.length > 0);

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

  /** Append a waypoint, reached by a leg of the given mode. */
  addWaypoint(lat: number, lng: number, label?: string, mode: LegMode = 'route') {
    if (this.locked()) return;
    this.record();
    [lat, lng] = [roundCoord(lat), roundCoord(lng)];
    const id = crypto.randomUUID();
    if (this.loop) {
      // Keep the route closed: the new point goes before the end, keeping the end leg's mode.
      this.waypoints.splice(this.waypoints.length - 1, 0, { id, lat, lng, label });
      this.legModes.splice(this.legModes.length - 1, 0, mode);
    } else {
      this.waypoints.push({ id, lat, lng, label });
      if (this.waypoints.length > 1) this.legModes.push(mode);
    }
    this.snap(id, { lat, lng });
  }

  /** Return to the start by adding a final waypoint at the start's position. */
  closeLoop() {
    if (this.locked() || this.loop || this.waypoints.length < 2) return;
    this.record();
    const { lat, lng, label, name } = this.waypoints[0];
    this.waypoints.push({ id: crypto.randomUUID(), lat, lng, label, name });
    this.legModes.push('route');
    this.loop = true;
    this.refresh();
  }

  setStart(lat: number, lng: number, label?: string) {
    if (this.locked()) return;
    if (this.waypoints.length === 0) return this.addWaypoint(lat, lng, label);
    this.record();
    [lat, lng] = [roundCoord(lat), roundCoord(lng)];
    const id = crypto.randomUUID();
    this.snapping.delete(this.waypoints[0].id);
    this.waypoints[0] = { id, lat, lng, label };
    this.mirrorStart();
    this.snap(id, { lat, lng });
  }

  /** Returns false if the move was refused. */
  moveWaypoint(id: string, lat: number, lng: number): boolean {
    if (this.locked()) return false;
    const wp = this.waypoints.find((w) => w.id === id);
    if (!wp) return false;
    this.record();
    [lat, lng] = [roundCoord(lat), roundCoord(lng)];
    if (haversine([wp.lat, wp.lng], [lat, lng]) > NAME_ALLOWED_RADIUS_M) wp.name = undefined;
    wp.lat = lat;
    wp.lng = lng;
    wp.label = undefined;
    this.mirrorStart();
    this.snap(id, { lat, lng });
    return true;
  }

  /** Give a waypoint a name of the user's own; an empty name removes it, showing the label or coordinates again. */
  renameWaypoint(id: string, name: string) {
    if (this.locked()) return;
    let wp = this.waypoints.find((w) => w.id === id);
    if (!wp) return;
    const next = name.trim() || undefined;
    if (next === wp.name) return;
    this.record();
    // The end of a loop mirrors the start, so naming either names both.
    if (this.loop && wp === this.waypoints[this.waypoints.length - 1]) wp = this.waypoints[0];
    wp.name = next;
    this.mirrorStart();
  }

  removeWaypoint(id: string) {
    if (this.locked() || !this.waypoints.some((w) => w.id === id)) return;
    this.record();
    this.remove(id);
  }

  /** Revert the last edit. */
  undo() {
    if (this.locked()) return;
    // Skip states the route is already in, e.g. from an optimise that removed nothing.
    const current = JSON.stringify(this.snapshot());
    const same = (s: Snapshot) => !s.doc && JSON.stringify(s) === current;
    let n = this.history.length;
    while (n > 0 && same(this.history[n - 1])) n--;
    if (n === 0) {
      this.history = [];
      return;
    }
    const prev = this.history[n - 1];
    this.history = this.history.slice(0, n - 1);
    this.restore(prev);
  }

  clear() {
    if (this.locked()) return;
    this.record(true);
    this.name = '';
    this.savedId = null;
    this.waypoints = [];
    this.legModes = [];
    this.loop = false;
    this.snapping.clear();
    this.refresh();
  }

  /** Removing the start of a loop removes the end first, reopening the loop. */
  private remove(id: string) {
    let i = this.waypoints.findIndex((w) => w.id === id);
    if (i < 0) return;
    if (this.loop && (i === 0 || i === this.waypoints.length - 1)) i = this.waypoints.length - 1;
    this.snapping.delete(this.waypoints[i].id);
    this.waypoints.splice(i, 1);
    if (this.legModes.length > 0) this.legModes.splice(Math.max(0, i - 1), 1);
    if (i === this.waypoints.length) this.loop = false;
    // A loop needs a waypoint besides the start and end.
    if (this.loop && this.waypoints.length < 3) {
      this.waypoints.pop();
      this.legModes.pop();
      this.loop = false;
    }
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
    // The whole optimise is undone in one step.
    this.record();
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
          this.remove(wp.id);
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
    if (this.locked()) return;
    this.record();
    this.legModes[i] = this.legModes[i] === 'route' ? 'direct' : 'route';
    this.refresh();
  }

  /** Replace the route. Its points are taken as already snapped. */
  load(state: RouteState, savedId: string | null = null) {
    if (this.locked()) return;
    // Nothing to go back to when the planner starts from a link.
    if (this.waypoints.length) this.record(true);
    this.snapping.clear();
    this.savedId = savedId;
    this.name = state.name;
    this.waypoints = state.waypoints.map(({ lat, lng, label, name }) => ({ id: crypto.randomUUID(), lat, lng, label, name }));
    this.legModes = [...state.legModes];
    const [first, last] = [this.waypoints[0], this.waypoints[this.waypoints.length - 1]];
    this.loop = this.waypoints.length > 2 && first.lat === last.lat && first.lng === last.lng;
    this.refresh();
    if (state.waypoints.length) this.focus = state.waypoints.map((w) => [w.lat, w.lng]);
  }

  toState(): RouteState {
    return {
      name: this.name,
      waypoints: this.waypoints.map(({ lat, lng, label, name }) => ({ lat, lng, label, name })),
      legModes: $state.snapshot(this.legModes),
    };
  }

  /** Optimise reroutes the route as it stands, so edits are refused (with a notice) until it finishes. */
  private locked() {
    if (!this.optimising) return false;
    this.notice = { text: 'Hang tight — your route is being optimised. You can make changes again once it’s done.' };
    return true;
  }

  private snapshot(): Snapshot {
    return {
      waypoints: $state.snapshot(this.waypoints),
      legModes: $state.snapshot(this.legModes),
      loop: this.loop,
      snapping: [...this.snapping],
    };
  }

  /** Save the route before an edit, so it can be undone. */
  private record(doc = false) {
    const s = this.snapshot();
    if (doc) s.doc = { name: this.name, savedId: this.savedId };
    this.history = [...this.history.slice(-(UNDO_LIMIT - 1)), s];
  }

  private restore(s: Snapshot) {
    if (s.doc) ({ name: this.name, savedId: this.savedId } = s.doc);
    this.waypoints = s.waypoints;
    this.legModes = s.legModes;
    this.loop = s.loop;
    this.snapping.clear();
    this.refresh();
    // Points that were still snapping when the edit was made snap again.
    for (const [id, requested] of s.snapping) this.snap(id, requested);
  }

  /** Rebuild legs from waypoints, reusing unchanged legs and routing only new ones. */
  private refresh() {
    const existing = new Map(this.legs.map((l) => [l.key, l]));
    const next: LegState[] = [];
    // The end of a loop follows the start, so it waits on the start's snap too.
    const endId = this.loop ? this.waypoints[this.waypoints.length - 1].id : undefined;
    const waiting = (id: string) => this.snapping.has(id) || (id === endId && this.snapping.has(this.waypoints[0].id));
    for (let i = 0; i < this.waypoints.length - 1; i++) {
      const a = $state.snapshot(this.waypoints[i]);
      const b = $state.snapshot(this.waypoints[i + 1]);
      const mode = this.legModes[i];
      const key = legKey(a, b, mode);
      const prev = existing.get(key);
      if (waiting(a.id) || waiting(b.id)) {
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
    // Skip the request, or ignore its result, if the waypoint was moved or removed since.
    const wanted = () => this.snapping.get(id) === requested;
    snapToPath(requested, SNAP_RADIUS_M, wanted).then((p) => {
      if (!wanted()) return;
      this.snapping.delete(id);
      const [lat, lng] = [roundCoord(p.lat), roundCoord(p.lng)];
      const wp = this.waypoints.find((w) => w.id === id);
      if (wp) [wp.lat, wp.lng] = [lat, lng];
      // Edits made while this point was snapping are undone to the snapped position.
      this.history = this.history.map((s) => {
        if (!s.snapping.some(([sid, r]) => sid === id && r === requested)) return s;
        // The end of a loop follows its start.
        const end = s.loop && s.waypoints[0].id === id ? s.waypoints.length - 1 : -1;
        const waypoints = s.waypoints.map((w, i) => (w.id === id || i === end ? { ...w, lat, lng } : w));
        return { ...s, waypoints, snapping: s.snapping.filter(([sid]) => sid !== id) };
      });
      this.mirrorStart();
      this.refresh();
    });
  }

  /** Keep the end of a loop on the start. */
  private mirrorStart() {
    if (!this.loop) return;
    const [start, end] = [this.waypoints[0], this.waypoints[this.waypoints.length - 1]];
    end.lat = start.lat;
    end.lng = start.lng;
    end.label = start.label;
    end.name = start.name;
  }

  private updateLeg(key: string, state: LegState) {
    // Ignore results for legs that have since changed.
    if (this.legs.some((l) => l.key === key)) {
      this.legs = this.legs.map((l) => (l.key === key ? state : l));
    }
  }
}

export const planner = new Planner();

/** What an optimise that removed this many waypoints did, for the user. */
export function optimiseResultText(removed: number): string {
  return removed ? `Removed ${removed} unneeded waypoint${removed === 1 ? '' : 's'}.` : 'No waypoints were removed - route already optimised.';
}
