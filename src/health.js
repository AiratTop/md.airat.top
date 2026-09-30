/**
 * The liveness probe, and the reason it is not a one-liner.
 *
 * `/health` sits ahead of the rate limiter on purpose: a status checker that receives a
 * 429 reports an outage that is not happening. That leaves it as the one unmetered path
 * to D1, so it must not turn request volume into database load.
 *
 * Two things stop it. A short cache, so a stream of probes costs one query per interval.
 * And single-flight, because a cache alone does not: it is filled only once the query
 * returns, so every probe arriving while the first is still in flight passes the same
 * empty cache and starts a query of its own. A hundred concurrent probes made a hundred
 * queries — the stampede the cache was supposed to prevent. Concurrent callers now await
 * the one query already running.
 */

const TTL_MS = 10_000;

let cache = { at: 0, payload: /** @type {{ status: string, database: string } | null} */ (null), status: 200 };

/** The query in flight, if there is one. Concurrent probes await this instead of starting another. */
let inFlight = /** @type {Promise<typeof cache> | null} */ (null);

/**
 * Clears the cached answer. Used by tests, which share an isolate and would otherwise
 * inherit whatever the previous test left behind. Calling it in production would cost one
 * extra query and nothing else.
 */
export function resetHealthCache() {
  cache = { at: 0, payload: null, status: 200 };
  inFlight = null;
}

async function probe(env) {
  try {
    // Reads the table rather than `SELECT 1`, which answers even when no migration has
    // ever run — a Worker deployed ahead of its schema reported healthy right up until
    // the first person tried to store something.
    await env.DB.prepare("SELECT id FROM shares LIMIT 1").first();
    cache = { at: Date.now(), payload: { status: "ok", database: "ok" }, status: 200 };
  } catch {
    // Cached like the healthy answer: an outage must not be convertible into extra load.
    cache = { at: Date.now(), payload: { status: "degraded", database: "unavailable" }, status: 503 };
  }
  return cache;
}

/** @returns {Promise<{ payload: { status: string, database: string }, status: number }>} */
export async function checkHealth(env) {
  if (cache.payload && Date.now() - cache.at < TTL_MS) {
    return { payload: cache.payload, status: cache.status };
  }

  // Assigned before the first await, so every probe that arrives during the query sees it.
  inFlight ??= probe(env).finally(() => {
    inFlight = null;
  });

  const result = await inFlight;
  return { payload: /** @type {{ status: string, database: string }} */ (result.payload), status: result.status };
}
