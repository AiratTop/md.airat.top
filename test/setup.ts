import { env, applyD1Migrations } from "cloudflare:test";

/**
 * Each test file gets isolated storage, and an isolated D1 starts with no tables. The
 * migrations are read by `vitest.config.ts`, handed over as the `TEST_MIGRATIONS`
 * binding declared in `env.d.ts`, and applied here, so the schema under test is the one in `migrations/`
 * rather than a copy that can drift from it.
 */
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
