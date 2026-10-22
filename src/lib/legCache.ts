import type { LegResult } from './routing';

export interface LegCacheOptions {
  /** Entries older than this are ignored and removed. Reading an entry doesn't extend it. */
  ttlMs: number;
  /** Cap on the summed size (in characters) of stored entries; the oldest are evicted past it. */
  maxChars: number;
  /** Part of every key; change it to drop entries stored under an old format or routing profile. */
  namespace: string;
}

interface Entry {
  /** When the leg was fetched (ms since epoch). */
  t: number;
  r: LegResult;
}

const PREFIX = 'brp.leg.';

/**
 * Routed legs kept in localStorage across visits, so reopening a route doesn't hit BRouter again.
 * Every operation swallows storage errors: the cache is an optimisation, never a reason to fail.
 */
export class LegCache {
  /** Stored entries by storage key, oldest first. Built once from storage, then kept in step with it. */
  private index: Map<string, { t: number; size: number }> | null = null;

  constructor(
    private opts: LegCacheOptions,
    private storage: () => Storage | undefined = () => globalThis.localStorage,
    private now: () => number = Date.now,
  ) {}

  private storageKey(key: string) {
    return `${PREFIX}${this.opts.namespace}:${key}`;
  }

  /** Scan storage, dropping expired entries and ones from other namespaces. */
  private load(store: Storage) {
    if (this.index) return this.index;
    const found: [string, { t: number; size: number }][] = [];
    const ours = `${PREFIX}${this.opts.namespace}:`;
    const stale: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const raw = store.getItem(k);
      let t = NaN;
      try {
        if (raw && k.startsWith(ours)) t = (JSON.parse(raw) as Entry).t;
      } catch {
        // Corrupt entry: dropped below.
      }
      if (raw && this.fresh(t)) found.push([k, { t, size: k.length + raw.length }]);
      else stale.push(k);
    }
    for (const k of stale) store.removeItem(k);
    found.sort((a, b) => a[1].t - b[1].t);
    this.index = new Map(found);
    return this.index;
  }

  private fresh(t: number) {
    return Number.isFinite(t) && this.now() - t < this.opts.ttlMs;
  }

  private remove(store: Storage, index: Map<string, unknown>, k: string) {
    store.removeItem(k);
    index.delete(k);
  }

  get(key: string): LegResult | undefined {
    try {
      const store = this.storage();
      if (!store) return undefined;
      const index = this.load(store);
      const k = this.storageKey(key);
      const raw = store.getItem(k);
      if (!raw) return undefined;
      const entry: Entry = JSON.parse(raw);
      if (this.fresh(entry.t)) return entry.r;
      this.remove(store, index, k);
    } catch {
      // Unavailable or corrupt storage: treat as a miss.
    }
    return undefined;
  }

  set(key: string, result: LegResult) {
    try {
      const store = this.storage();
      if (!store) return;
      const index = this.load(store);
      const k = this.storageKey(key);
      const t = this.now();
      const raw = JSON.stringify({ t, r: result } satisfies Entry);
      const size = k.length + raw.length;
      if (size > this.opts.maxChars) return;
      this.remove(store, index, k);
      let total = size;
      for (const e of index.values()) total += e.size;
      // Oldest first: evict until the new entry fits under the cap, and again if the browser's quota is hit.
      const oldest = () => index.keys().next().value as string | undefined;
      for (let victim = oldest(); total > this.opts.maxChars && victim; victim = oldest()) {
        total -= index.get(victim)!.size;
        this.remove(store, index, victim);
      }
      for (;;) {
        try {
          store.setItem(k, raw);
          index.set(k, { t, size });
          return;
        } catch {
          const victim = oldest();
          if (!victim) return;
          this.remove(store, index, victim);
        }
      }
    } catch {
      // Unavailable storage: skip caching.
    }
  }

  /** Remove every cached leg, e.g. to free space for something that matters more. */
  clear() {
    try {
      const store = this.storage();
      if (!store) return;
      const keys: string[] = [];
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k?.startsWith(PREFIX)) keys.push(k);
      }
      for (const k of keys) store.removeItem(k);
      this.index = new Map();
    } catch {
      // Nothing to free.
    }
  }
}
