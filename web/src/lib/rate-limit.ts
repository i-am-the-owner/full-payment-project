/**
 * A small sliding-window limiter for the contact form. It counts in this
 * process's memory, so with several server instances each has its own count: a
 * stopgap against casual abuse, not a bot defence (that needs a shared store or a
 * gateway/WAF; see GO_LIVE.md).
 */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #max: number;
  readonly #windowMs: number;

  constructor(max: number, windowMs: number) {
    this.#max = max;
    this.#windowMs = windowMs;
  }

  /** Records a hit and says whether it is allowed. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.#hits.get(key) ?? []).filter(
      (t) => now - t < this.#windowMs,
    );
    if (recent.length >= this.#max) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 5000) {
      for (const [k, times] of this.#hits) {
        if (times.every((t) => now - t >= this.#windowMs)) this.#hits.delete(k);
      }
    }
    return true;
  }
}
