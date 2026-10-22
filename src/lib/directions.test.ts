import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodePolyline, describeRoute, encodePolyline, formatDistance, narrate, parseTrace, simplify, splitNames, type Step } from './directions';
import { directLeg, parseBRouter } from './routing';

const read = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const leg = parseBRouter(read('brouter-sample.json'));
const trace = read('valhalla-trace-sample.json');

describe('polyline', () => {
  it('round-trips at 6 decimal places', () => {
    const coords: [number, number][] = [
      [-37.822048, 144.952377],
      [-37.822255, 144.951697],
      [51.5, -0.12],
    ];
    expect(decodePolyline(encodePolyline(coords))).toEqual(coords);
  });

  it('decodes the shape Valhalla returns', () => {
    const shape = decodePolyline(trace.trip.legs[0].shape);
    expect(shape[0][0]).toBeCloseTo(-37.822, 2);
    expect(shape[0][1]).toBeCloseTo(144.952, 2);
  });
});

describe('parseTrace', () => {
  const steps = parseTrace(trace, leg);

  it('keeps every maneuver but the arrival, with street names where OSM has them', () => {
    expect(steps).toHaveLength(trace.trip.legs[0].maneuvers.length - 1);
    expect(steps[0].turn).toBe('start');
    expect(steps.filter((s) => s.name).map((s) => s.name)).toEqual(['Siddeley Street', 'Yarra Promenade', 'Southbank Promenade', 'Southbank Boulevard']);
  });

  it('describes unnamed ways by their BRouter category', () => {
    expect(steps[0].kind).toBe('the footpath');
    expect(steps.find((s) => !s.name && s.lengthM > 300)?.kind).toBe('the shared path');
  });

  it('merges a roundabout entry and exit into one step', () => {
    const json = {
      trip: {
        legs: [
          {
            shape: encodePolyline(leg.segments[0].coords),
            maneuvers: [
              { type: 1, length: 0.1, begin_shape_index: 0, end_shape_index: 1 },
              { type: 26, length: 0.02, roundabout_exit_count: 2, begin_shape_index: 1, end_shape_index: 1 },
              { type: 27, length: 0.2, street_names: ['Kings Way'], begin_shape_index: 1, end_shape_index: 2 },
              { type: 4, length: 0, begin_shape_index: 2, end_shape_index: 2 },
            ],
          },
        ],
      },
    };
    expect(parseTrace(json, leg)[1]).toMatchObject({ turn: 'roundabout', exit: 2, name: 'Kings Way', lengthM: 220 });
  });
});

describe('simplify', () => {
  const step = (turn: Step['turn'], lengthM: number, name?: string, kind = 'the road'): Step => ({ turn, name, kind, lengthM });

  it('folds short unnamed connectors into the step before', () => {
    const out = simplify([step('start', 100, 'A St'), step('right', 9), step('left', 12), step('left', 200, 'B St')]);
    expect(out).toEqual([step('start', 121, 'A St'), step('left', 200, 'B St')]);
  });

  it('keeps short named steps, roundabouts and direct legs', () => {
    const steps = [step('start', 100, 'A St'), step('left', 20, 'B St'), { ...step('roundabout', 15), exit: 1 }, step('direct', 10)];
    expect(simplify(steps)).toEqual(steps);
  });

  it('folds a short unnamed first step into the next one', () => {
    expect(simplify([step('start', 10, undefined, 'the footpath'), step('right', 70, 'A St'), step('left', 80, 'B St')])).toEqual([
      step('start', 80, 'A St'),
      step('left', 80, 'B St'),
    ]);
  });

  it('calls ways that share a trail name by that name', () => {
    const out = simplify([
      step('left', 800, 'Capital City Trail'),
      { ...step('continue', 150, 'Main Yarra Trail'), also: ['Capital City Trail'] },
      { ...step('left', 240, 'Main Yarra Trail'), also: ['Capital City Trail'] },
    ]);
    expect(out).toEqual([step('left', 1190, 'Capital City Trail')]);
  });

  it('joins every step that stays on the same way, turns included', () => {
    const out = simplify([step('start', 100, 'A St'), step('continue', 50, 'A St'), step('keep left', 50, 'A St'), step('left', 80, 'A St'), step('right', 60, 'B St')]);
    expect(out).toEqual([step('start', 280, 'A St'), step('right', 60, 'B St')]);
  });

  it('joins unnamed ways of the same kind, but not different kinds', () => {
    const out = simplify([step('left', 300, undefined, 'the shared path'), step('left', 200, undefined, 'the shared path'), step('right', 100, undefined, 'the road')]);
    expect(out).toEqual([step('left', 500, undefined, 'the shared path'), step('right', 100, undefined, 'the road')]);
  });

  it('leaves out a short stretch on another way that returns to the way before', () => {
    const out = simplify([step('start', 500, 'A St'), step('left', 390, 'B St'), step('right', 300, 'A St'), step('right', 100, 'C St')]);
    expect(out).toEqual([step('start', 1190, 'A St'), step('right', 100, 'C St')]);
  });

  it('keeps a stretch of 400 m or more, or one that leads somewhere else', () => {
    const long = [step('start', 500, 'A St'), step('left', 400, 'B St'), step('right', 300, 'A St')];
    expect(simplify(long)).toEqual(long);
    const onward = [step('start', 500, 'A St'), step('left', 100, 'B St'), step('right', 300, 'C St')];
    expect(simplify(onward)).toEqual(onward);
  });

  it('counts the connectors after a stretch towards its length, and not as a return', () => {
    const shared = (turn: Step['turn'], lengthM: number) => step(turn, lengthM, undefined, 'the shared path');
    const steps = [shared('start', 400), step('left', 390, 'Flinders Walk'), shared('continue', 35), step('right', 300, 'Birrarung Marr Walk')];
    expect(simplify(steps)).toEqual([shared('start', 400), step('left', 425, 'Flinders Walk'), step('right', 300, 'Birrarung Marr Walk')]);
  });

  it('matches the way before by any of its trail names', () => {
    const out = simplify([step('start', 500, 'Capital City Trail'), step('left', 140, 'Jim Stynes Bridge'), { ...step('right', 300, 'Main Yarra Trail'), also: ['Capital City Trail'] }]);
    expect(out).toEqual([step('start', 940, 'Capital City Trail')]);
  });

  it('keeps a roundabout back onto the same way', () => {
    const steps = [step('start', 100, 'A St'), { ...step('roundabout', 200, 'A St'), exit: 2 }];
    expect(simplify(steps)).toEqual(steps);
  });
});

describe('narrate', () => {
  it('writes one line per step', () => {
    expect(narrate(simplify(parseTrace(trace, leg)), { start: 'Federation Square', loop: false })).toEqual([
      'Start at Federation Square and head along the footpath for 120 m',
      'Turn left onto Siddeley Street and follow it for 70 m',
      'Bear left onto the shared path and follow it for 660 m',
      'Continue onto Yarra Promenade for 540 m',
      'Turn left onto Southbank Promenade and follow it for 80 m',
      'Turn right onto the shared path and follow it for 110 m',
      'Turn left onto Southbank Boulevard and follow it for 520 m',
      'Continue onto the road for 50 m',
      'Arrive at the finish',
    ]);
  });

  it('ends a loop back at the start', () => {
    const steps: Step[] = [
      { turn: 'start', kind: 'the shared path', lengthM: 300 },
      { turn: 'left', name: 'A St', kind: 'the road', lengthM: 200 },
    ];
    expect(narrate(steps, { loop: true })).toEqual(['Head along the shared path for 300 m', 'Turn left onto A St and follow it for 200 m', 'Arrive back at the start']);
  });

  it('names roundabout exits and the end', () => {
    const steps: Step[] = [
      { turn: 'start', name: 'A St', kind: 'the road', lengthM: 1250 },
      { turn: 'roundabout', exit: 3, name: 'B Rd', kind: 'the road', lengthM: 400 },
    ];
    expect(narrate(steps, { end: 'the pub', loop: false })).toEqual(['Head along A St for 1.3 km', 'Take the 3rd exit at the roundabout onto B Rd for 400 m', 'Arrive at the pub']);
  });
});

describe('splitNames', () => {
  it('splits trail names Valhalla ran together', () => {
    expect(splitNames('Capital City Trail Main Yarra Trail')).toEqual(['Capital City Trail', 'Main Yarra Trail']);
    expect(splitNames('Southbank Boulevard')).toEqual(['Southbank Boulevard']);
    expect(splitNames('Trail Street')).toEqual(['Trail Street']);
    expect(splitNames('Merri Creek Trail Road')).toEqual(['Merri Creek Trail Road']);
    expect(splitNames('Trail Trail')).toEqual(['Trail Trail']);
  });
});

describe('formatDistance', () => {
  it('rounds metres to 10 and switches to km from 1 km', () => {
    expect(formatDistance(3)).toBe('10 m');
    expect(formatDistance(544)).toBe('540 m');
    expect(formatDistance(1049)).toBe('1.0 km');
  });
});

describe('describeRoute', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('traces routed legs, describes direct legs, and carries on across waypoints', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(trace)));
    vi.stubGlobal('fetch', fetch);
    const direct = directLeg({ lat: -37.82, lng: 144.96 }, { lat: -37.821, lng: 144.96 });
    const lines = await describeRoute(
      [
        { key: 'route:test-a', mode: 'route', result: leg },
        { key: 'direct:test-b', mode: 'direct', result: direct },
      ],
      { start: 'Federation Square', loop: false },
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ costing: 'pedestrian', shape_match: 'map_snap' });
    expect(lines.at(-2)).toBe('Ride in a straight line (off the mapped route) for 110 m');
  });

  it('reports the service error and retries on the next request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No suitable edges near location' }), { status: 400 })));
    const legs = [{ key: 'route:test-error', mode: 'route' as const, result: leg }];
    await expect(describeRoute(legs, { loop: false })).rejects.toThrow('Directions failed: No suitable edges near location');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(trace))));
    await expect(describeRoute(legs, { loop: false })).resolves.toContain('Turn left onto Southbank Boulevard and follow it for 520 m');
  });
});
