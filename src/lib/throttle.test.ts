import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Throttle } from './throttle';

const opts = { burstBaseMs: 100, burstMaxMs: 400, quietMs: 1000, rejectBaseMs: 2000, rejectMaxMs: 5000, maxRetries: 2 };

/** A throttle whose fetch answers instantly with the next status in `statuses` (200 once they run out), logging send times. */
function setup(statuses: number[] = []) {
  const sent: { url: string; at: number }[] = [];
  const throttle = new Throttle(opts, async (url) => {
    sent.push({ url, at: Date.now() });
    return new Response(null, { status: statuses.shift() ?? 200 });
  });
  return { throttle, sent };
}

describe('Throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it('sends a lone request at once', async () => {
    const { throttle, sent } = setup();
    const res = throttle.fetch('a');
    await vi.advanceTimersByTimeAsync(0);
    expect((await res)?.status).toBe(200);
    expect(sent).toEqual([{ url: 'a', at: 0 }]);
  });

  it('spaces a burst out exponentially, up to the max', async () => {
    const { throttle, sent } = setup();
    const all = Promise.all(['a', 'b', 'c', 'd', 'e'].map((u) => throttle.fetch(u)));
    await vi.runAllTimersAsync();
    await all;
    expect(sent.map((s) => s.at)).toEqual([0, 100, 300, 700, 1100]);
  });

  it('counts requests spread over time as one burst until a quiet gap', async () => {
    const { throttle, sent } = setup();
    void throttle.fetch('a');
    await vi.advanceTimersByTimeAsync(50);
    void throttle.fetch('b'); // 50 ms after a: waits until 100
    await vi.advanceTimersByTimeAsync(2000);
    void throttle.fetch('c'); // after a quiet gap: at once
    await vi.runAllTimersAsync();
    expect(sent.map((s) => s.at)).toEqual([0, 100, 2050]);
  });

  it('backs off and retries on 403, then resets after a success', async () => {
    const { throttle, sent } = setup([403, 403]);
    const res = throttle.fetch('a');
    const later = throttle.fetch('b');
    await vi.runAllTimersAsync();
    expect((await res)?.status).toBe(200);
    expect((await later)?.status).toBe(200);
    // a at 0 (403), retried after 2000 (403), retried after 4000 more (ok); b then follows as part of the burst.
    expect(sent).toEqual([
      { url: 'a', at: 0 },
      { url: 'a', at: 2000 },
      { url: 'a', at: 6000 },
      { url: 'b', at: 6400 },
    ]);
  });

  it('hands back the rejection once retries run out, capping the wait', async () => {
    const { throttle, sent } = setup([429, 429, 429]);
    const res = throttle.fetch('a');
    await vi.runAllTimersAsync();
    expect((await res)?.status).toBe(429);
    expect(sent.map((s) => s.at)).toEqual([0, 2000, 6000]);
    // The next request still waits out the (capped) back-off.
    void throttle.fetch('b');
    await vi.runAllTimersAsync();
    expect(sent.at(-1)).toEqual({ url: 'b', at: 6000 + 5000 });
  });

  it('skips requests no longer wanted when their turn comes', async () => {
    const { throttle, sent } = setup();
    let wanted = true;
    void throttle.fetch('a');
    const skipped = throttle.fetch('b', () => wanted);
    wanted = false;
    await vi.runAllTimersAsync();
    expect(await skipped).toBeNull();
    expect(sent.map((s) => s.url)).toEqual(['a']);
  });

  it('passes network errors through and carries on', async () => {
    let calls = 0;
    const throttle = new Throttle(opts, async () => {
      if (calls++ === 0) throw new TypeError('offline');
      return new Response(null, { status: 200 });
    });
    const failed = throttle.fetch('a');
    const ok = throttle.fetch('b');
    failed.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(failed).rejects.toThrow('offline');
    expect((await ok)?.status).toBe(200);
  });
});
