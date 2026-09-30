/**
 * md.airat.top — a markdown live preview that runs in the browser, plus share links that
 * delete themselves after 24 hours.
 *
 * The editor is static and never sends anything anywhere. Sharing is the one explicit
 * exception: the author presses Share, confirms, and a snapshot of the text is stored in
 * D1 as plaintext so that anyone holding the link — a person, curl, a model — can read it.
 *
 * Routes:
 *   /                  the editor (static; the only indexable page)
 *   /{id}              a shared document's page
 *   /{id}.md           the shared markdown, raw
 *   /{id}.json         the shared markdown with its metadata
 *   /api/...           see api.js
 *   /health            liveness, including a D1 round trip
 *   everything else    static assets, then the asset server's own 404
 */

import { routeApi } from "./api.js";
import { isShareId } from "./ids.js";
import { deleteExpired } from "./db.js";
import { serveShare } from "./share.js";
import { checkHealth } from "./health.js";
import { RATE_LIMITS, SWEEP_BATCH, SWEEP_MAX_BATCHES } from "./limits.js";
import { json, error, redirect, withPageHeaders } from "./http.js";

/** Serves a file out of `public_html` under a different path than it was requested at. */
function serveAsset(request, env, assetPath) {
  const url = new URL(request.url);
  url.pathname = assetPath;
  return env.ASSETS.fetch(new Request(url, request));
}

/** Asks the caller's counter for one more request; returns seconds to wait, or 0. */
async function spend(env, key, { limit, periodSeconds }) {
  const counter = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(key));
  const { allowed, retryAfter } = await (
    await counter.fetch("https://rate-limiter/count", {
      method: "POST",
      body: JSON.stringify({ limit, periodSeconds })
    })
  ).json();
  return allowed ? 0 : retryAfter;
}

/**
 * Per-address flood protection on the API. Creating a share is metered twice — per
 * minute against a burst, per day against a patient script — because it is the one act
 * here that costs storage. Reading a share is not metered at all: it is a primary-key
 * lookup, and a recipient must never be locked out by traffic from the author's office.
 *
 * The binding is absent only in a bare local dev server; a missing binding means no
 * limit, which is never true of a deployment.
 */
async function enforceRateLimit(request, env, url) {
  if (!env.RATE_LIMITER) return null;

  // Set at the edge, overwriting whatever the client sent.
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const creating = request.method === "POST" && url.pathname === "/api/shares";

  const retryAfter = creating
    ? (await spend(env, `write-minute:${address}`, RATE_LIMITS.writeMinute)) ||
      (await spend(env, `write-day:${address}`, RATE_LIMITS.writeDay))
    : await spend(env, `other:${address}`, RATE_LIMITS.other);

  if (!retryAfter) return null;
  return json(
    { error: "Too many requests. Try again later.", code: "rate_limited" },
    429,
    { "Retry-After": String(retryAfter) }
  );
}

/** `/{id}`, `/{id}.md`, `/{id}.json` — any case, so the router can redirect to upper. */
const SHARE_PATH = /^\/([0-9A-Za-z]{26})(\.md|\.json)?$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      const { payload, status } = await checkHealth(env);
      return json(payload, status);
    }

    // `html_handling` is off, so the root has to be mapped to its file here.
    if (path === "/" || path === "/index.html") {
      return withPageHeaders(await serveAsset(request, env, "/index.html"));
    }

    // The shared-document shell is only ever served filled in, under `/{id}`.
    if (path === "/view.html") return error("Not found.", 404);

    if (path.startsWith("/api/")) {
      const limited = await enforceRateLimit(request, env, url);
      if (limited) return limited;

      const response = routeApi(request, env, url);
      if (response) return response;
      return error("Unknown endpoint.", 404);
    }

    const share = SHARE_PATH.exec(path);
    if (share) {
      const [, candidate, suffix = ""] = share;
      const id = candidate.toUpperCase();
      if (isShareId(id)) {
        // Crockford base32 is case-insensitive, but one share should have one URL.
        if (candidate !== id) return redirect(`${url.origin}/${id}${suffix}${url.search}`);
        if (request.method !== "GET" && request.method !== "HEAD") return error("Method not allowed.", 405);
        return serveShare(request, env, id, suffix === ".md" ? "md" : suffix === ".json" ? "json" : "page");
      }
    }

    return withPageHeaders(await env.ASSETS.fetch(request));
  },

  /**
   * Housekeeping. Expiry is enforced in every read, so an expired share is unreachable
   * before this runs; the sweep is what keeps the table from growing without bound.
   */
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sweep(env));
  }
};

/** Deletes expired rows in bounded batches, stopping as soon as a batch comes back short. */
export async function sweep(env) {
  let total = 0;
  for (let batch = 0; batch < SWEEP_MAX_BATCHES; batch++) {
    const deleted = await deleteExpired(env.DB, Date.now(), SWEEP_BATCH);
    total += deleted;
    if (deleted < SWEEP_BATCH) break;
  }
  if (total > 0) console.log(`retention: deleted ${total} expired shares`);
  return total;
}

export { RateLimiter } from "./rate-limiter.js";
