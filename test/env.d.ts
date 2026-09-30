/**
 * The one binding the deployed Worker does not have.
 *
 * Everything else — DB, ASSETS, SITE_HOST, the rate limiters — comes from
 * `worker-configuration.d.ts`, which `wrangler types` generates from `wrangler.jsonc`.
 * Generated rather than written by hand so the types cannot drift from the bindings that
 * actually deploy; `npm run typecheck` regenerates it first, and it is not committed.
 */
declare namespace Cloudflare {
  interface Env {
    /** Supplied by vitest.config.ts, read out of the real `migrations/` directory. */
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}
