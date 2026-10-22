export interface ThrottleOptions {
  /** Gap before the 2nd request of a burst; each later request in the burst doubles it. */
  burstBaseMs: number;
  /** Longest gap between requests in a burst. */
  burstMaxMs: number;
  /** A burst ends once no request has finished for this long. */
  quietMs: number;
  /** First wait after a rejected (403/429) response; doubles with each rejection in a row. */
  rejectBaseMs: number;
  /** Longest wait after a rejected response. */
  rejectMaxMs: number;
  /** Times a rejected request is sent again before its response is handed back. */
  maxRetries: number;
}

interface Job {
  url: string;
  isWanted?: () => boolean;
  retries: number;
  resolve: (res: Response | null) => void;
  reject: (err: unknown) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Responses that mean the server is refusing us for sending too much. */
export const isRejected = (status: number) => status === 403 || status === 429;

/**
 * Sends requests one at a time, spacing them out further the longer a burst of
 * requests goes on (rapid clicking, optimise), and backing off exponentially when
 * the server rejects requests.
 */
export class Throttle {
  private queue: Job[] = [];
  private running = false;
  /** Requests sent in the current burst. */
  private burst = 0;
  private lastDone = -Infinity;
  /** Wait imposed by the last rejection, 0 once a request succeeds. */
  private rejectWaitMs = 0;

  constructor(
    private opts: ThrottleOptions,
    private doFetch: (url: string) => Promise<Response> = (url) => fetch(url),
  ) {}

  /**
   * Queue a GET of url. Resolves with the response, or null if isWanted() returned false
   * by the time the request's turn came (so it was never sent).
   */
  fetch(url: string, isWanted?: () => boolean): Promise<Response | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ url, isWanted, retries: 0, resolve, reject });
      if (!this.running) void this.drain();
    });
  }

  /** The wait before the next request, given how long it has been since the last one finished. */
  private delay(idleMs: number): number {
    if (idleMs >= this.opts.quietMs) this.burst = 0;
    const burstWait = this.burst === 0 ? 0 : Math.min(this.opts.burstBaseMs * 2 ** (this.burst - 1), this.opts.burstMaxMs);
    return Math.max(burstWait, this.rejectWaitMs) - idleMs;
  }

  private async drain() {
    this.running = true;
    try {
      while (this.queue.length) {
        const wait = this.delay(Date.now() - this.lastDone);
        if (wait > 0) await sleep(wait);
        const job = this.queue.shift()!;
        if (job.isWanted && !job.isWanted()) {
          job.resolve(null);
          continue;
        }
        this.burst++;
        let res: Response;
        try {
          res = await this.doFetch(job.url);
        } catch (err) {
          job.reject(err);
          continue;
        } finally {
          this.lastDone = Date.now();
        }
        if (isRejected(res.status)) {
          this.rejectWaitMs = Math.min(this.rejectWaitMs ? this.rejectWaitMs * 2 : this.opts.rejectBaseMs, this.opts.rejectMaxMs);
          if (job.retries < this.opts.maxRetries) {
            job.retries++;
            this.queue.unshift(job);
            continue;
          }
        } else if (res.ok) {
          this.rejectWaitMs = 0;
        }
        job.resolve(res);
      }
    } finally {
      this.running = false;
    }
  }
}
