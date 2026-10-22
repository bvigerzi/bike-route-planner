import { describe, expect, it } from 'vitest';
import { LegCache, type LegCacheOptions } from './legCache';
import type { LegResult } from './routing';

/** An in-memory Storage that throws once more than quota characters are stored. */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  constructor(private quota = Infinity) {}
  get length() {
    return this.data.size;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    let used = k.length + v.length;
    for (const [ok, ov] of this.data) if (ok !== k) used += ok.length + ov.length;
    if (used > this.quota) throw new DOMException('full', 'QuotaExceededError');
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  clear() {
    this.data.clear();
  }
}

const leg = (distanceM: number): LegResult => ({
  segments: [{ category: 'road', coords: [[-37.8, 144.9], [-37.81, 144.9]] }],
  distanceM,
  timeS: 60,
  ascentM: 0,
});

const DAY = 24 * 60 * 60 * 1000;
const opts: LegCacheOptions = { ttlMs: DAY, maxChars: Infinity, namespace: 'v1:safety' };

function setup(o: Partial<LegCacheOptions> = {}, store = new MemoryStorage()) {
  const clock = { now: 0 };
  const make = () => new LegCache({ ...opts, ...o }, () => store, () => clock.now);
  return { cache: make(), make, store, clock };
}

describe('LegCache', () => {
  it('returns a stored leg, including from a fresh instance (a reload)', () => {
    const { cache, make } = setup();
    cache.set('a', leg(100));
    expect(cache.get('a')).toEqual(leg(100));
    expect(make().get('a')).toEqual(leg(100));
    expect(cache.get('b')).toBeUndefined();
  });

  it('expires entries after the TTL, counted from when they were stored', () => {
    const { cache, store, clock } = setup();
    cache.set('a', leg(100));
    clock.now = DAY - 1;
    expect(cache.get('a')).toBeDefined();
    clock.now = DAY;
    expect(cache.get('a')).toBeUndefined();
    expect(store.length).toBe(0);
  });

  it('drops expired, corrupt and other-namespace entries when first used', () => {
    const { cache, make, store, clock } = setup();
    cache.set('old', leg(1));
    clock.now = DAY / 2;
    cache.set('new', leg(2));
    store.setItem('brp.leg.v0:safety:x', JSON.stringify({ t: clock.now, r: leg(3) }));
    store.setItem('brp.leg.v1:safety:bad', '{');
    store.setItem('brp.routes', '[]');
    clock.now = DAY;
    make().get('new');
    expect([...Array(store.length)].map((_, i) => store.key(i)).sort()).toEqual(['brp.leg.v1:safety:new', 'brp.routes']);
  });

  it('evicts the oldest entries to stay under maxChars', () => {
    const { cache, store, clock } = setup();
    cache.set('probe', leg(0));
    const size = store.key(0)!.length + store.getItem(store.key(0)!)!.length;
    cache.clear();
    const capped = setup({ maxChars: size * 2 }).cache;
    for (const k of ['k1', 'k2', 'k3']) {
      capped.set(k, leg(0));
      clock.now++;
    }
    expect(capped.get('k1')).toBeUndefined();
    expect(capped.get('k2')).toBeDefined();
    expect(capped.get('k3')).toBeDefined();
  });

  it('evicts the oldest entries when the browser quota is hit, never other keys', () => {
    const store = new MemoryStorage(1000);
    store.setItem('brp.routes', 'x'.repeat(500));
    const { cache, clock } = setup({}, store);
    for (const k of ['k1', 'k2', 'k3', 'k4']) {
      cache.set(k, leg(0));
      clock.now++;
    }
    expect(cache.get('k4')).toBeDefined();
    expect(cache.get('k1')).toBeUndefined();
    expect(store.getItem('brp.routes')).toHaveLength(500);
  });

  it('clear removes every cached leg but nothing else', () => {
    const { cache, store } = setup();
    store.setItem('brp.routes', '[]');
    cache.set('a', leg(1));
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(store.length).toBe(1);
  });

  it('never throws when storage is unavailable', () => {
    const cache = new LegCache(opts, () => {
      throw new Error('denied');
    });
    expect(() => cache.set('a', leg(1))).not.toThrow();
    expect(cache.get('a')).toBeUndefined();
    expect(() => cache.clear()).not.toThrow();
  });
});
