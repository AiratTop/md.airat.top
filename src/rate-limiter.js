/**
 * Per-caller flood protection, counted somewhere that actually counts.
 *
 * This started as Cloudflare's rate limit binding, which is the documented answer and is
 * three lines. It enforces, but loosely: measured against the deployed Worker with the
 * binding set to 3 requests a minute, 23 of 39 consecutive calls under one key were
 * allowed before it began refusing. That is the documented behaviour rather than a fault
 * — "permissive, eventually consistent, and intentionally designed to not be used as an
 * accurate accounting system" — and it is the wrong shape here, because a burst is
 * precisely what fills a database, and the burst is what slips through before the count
 * propagates.
 *
 * One object per key, addressed by `idFromName`, so "ten writes a minute" means ten —
 * not ten per data centre, which is the accuracy the binding trades away.
 */
export class RateLimiter {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const { limit, periodSeconds } = await request.json();

    const periodMs = periodSeconds * 1000;
    const now = Date.now();
    const window = Math.floor(now / periodMs);

    /*
     * The count is in storage, not in an instance field.
     *
     * It was a field until an audit pointed out what that costs: an object with nothing
     * to do is evicted after seconds of idleness, the constructor runs again on the next
     * request, and the counter is back at zero inside a window that has not ended. Ten
     * writes, pause, ten more — the limit was a suggestion for anyone willing to wait.
     *
     * Durable Object storage survives that, and reads and writes to an object's own
     * storage are cheap and local. Requests to one object are also gated, so the
     * read-then-write below cannot interleave with itself.
     */
    const stored = await this.ctx.storage.get("counter");
    const count = (stored && stored.window === window ? stored.count : 0) + 1;
    await this.ctx.storage.put("counter", { window, count });

    /*
     * Storage now outlives the object, which means one row per address that has ever
     * called the API and no reason for any of them to go away. The alarm is the cleanup:
     * two windows after the last request, everything this object holds is deleted. A
     * caller who returns is counted from zero, which is correct — their window is long
     * over — and a caller who never returns leaves nothing behind.
     */
    await this.ctx.storage.setAlarm(now + periodMs * 2);

    const allowed = count <= limit;
    const retryAfter = Math.max(1, Math.ceil(((window + 1) * periodMs - now) / 1000));

    return Response.json({ allowed, retryAfter });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
