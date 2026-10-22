import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LatLng } from './routing';

vi.mock('./routing', async (importActual) => ({
  ...(await importActual<typeof import('./routing')>()),
  routeLeg: async () => ({ segments: [], distanceM: 0, timeS: 0, ascentM: 0 }),
  snapToPath: async (p: LatLng) => p,
}));

const { planner } = await import('./state.svelte');

const coords = () => planner.waypoints.map((w) => [w.lat, w.lng]);

describe('undo', () => {
  beforeEach(() => {
    planner.clear();
    while (planner.canUndo) planner.undo();
  });

  it('reverts moves, not just additions', () => {
    planner.addWaypoint(1, 1);
    planner.addWaypoint(2, 2);
    planner.moveWaypoint(planner.waypoints[0].id, 3, 3);
    planner.undo();
    expect(coords()).toEqual([
      [1, 1],
      [2, 2],
    ]);
    planner.undo();
    expect(coords()).toEqual([[1, 1]]);
  });

  it('restores removed waypoints in place', () => {
    planner.addWaypoint(1, 1);
    planner.addWaypoint(2, 2);
    planner.addWaypoint(3, 3);
    planner.removeWaypoint(planner.waypoints[1].id);
    planner.undo();
    expect(coords()).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('reverts leg modes and closing the loop', () => {
    planner.addWaypoint(1, 1);
    planner.addWaypoint(2, 2);
    planner.toggleLeg(0);
    planner.closeLoop();
    planner.undo();
    expect(planner.loop).toBe(false);
    expect(planner.legModes).toEqual(['direct']);
    planner.undo();
    expect(planner.legModes).toEqual(['route']);
  });

  it('restores a cleared route and its name', () => {
    planner.addWaypoint(1, 1);
    planner.name = 'Ride';
    planner.clear();
    planner.undo();
    expect(coords()).toEqual([[1, 1]]);
    expect(planner.name).toBe('Ride');
    expect(planner.canUndo).toBe(true);
    planner.undo();
    expect(coords()).toEqual([]);
    expect(planner.canUndo).toBe(false);
  });

  it('skips edits that changed nothing', async () => {
    planner.addWaypoint(1, 1);
    planner.addWaypoint(2, 2);
    await planner.optimise();
    planner.undo();
    expect(coords()).toEqual([[1, 1]]);
  });
});

describe('while optimising', () => {
  beforeEach(() => {
    planner.clear();
    while (planner.canUndo) planner.undo();
  });

  it('refuses edits and shows a notice', async () => {
    planner.addWaypoint(1, 1);
    planner.addWaypoint(2, 2);
    planner.addWaypoint(3, 3);
    planner.notice = null;
    const done = planner.optimise();
    const [first] = planner.waypoints;
    planner.addWaypoint(4, 4);
    expect(planner.moveWaypoint(first.id, 5, 5)).toBe(false);
    planner.removeWaypoint(first.id);
    planner.toggleLeg(0);
    planner.clear();
    expect(planner.notice).not.toBeNull();
    await done;
    expect(coords()).toEqual([
      [1, 1],
      [3, 3],
    ]);
    expect(planner.legModes).toEqual(['route']);
  });
});

describe('renameWaypoint', () => {
  beforeEach(() => {
    planner.clear();
    while (planner.canUndo) planner.undo();
  });

  it('names a waypoint, keeps the name when it is nudged, and removes it when empty', () => {
    planner.addWaypoint(1, 1, 'Main St');
    const { id } = planner.waypoints[0];
    planner.renameWaypoint(id, '  The bakery ');
    expect(planner.waypoints[0].name).toBe('The bakery');
    planner.moveWaypoint(id, 1.0001, 1);
    expect(planner.waypoints[0]).toMatchObject({ name: 'The bakery', label: undefined });
    planner.renameWaypoint(id, ' ');
    expect(planner.waypoints[0].name).toBeUndefined();
    planner.undo();
    expect(planner.waypoints[0].name).toBe('The bakery');
  });

  it('removes the name when the waypoint is dragged far', () => {
    planner.addWaypoint(1, 1);
    const { id } = planner.waypoints[0];
    planner.renameWaypoint(id, 'The bakery');
    planner.moveWaypoint(id, 1.001, 1); // ~110 m
    expect(planner.waypoints[0].name).toBe('The bakery');
    planner.moveWaypoint(id, 1.003, 1); // ~220 m
    expect(planner.waypoints[0].name).toBeUndefined();
  });

  it('names both ends of a loop', () => {
    planner.addWaypoint(1, 1);
    planner.addWaypoint(2, 2);
    planner.closeLoop();
    planner.renameWaypoint(planner.waypoints[2].id, 'Home');
    expect(planner.waypoints.map((w) => w.name)).toEqual(['Home', undefined, 'Home']);
    expect(planner.toState().waypoints[0].name).toBe('Home');
  });
});
