import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

/**
 * Tests run in `workerd` against a real local D1, not against a mock.
 *
 * That matters more here than it usually would. The invariant most worth testing — a
 * burn-after-reading link burns exactly once when two readers arrive together — is a
 * property of how D1 serialises a statement. A hand-written fake would either serialise
 * differently or not at all, and the test would pass while proving nothing.
 *
 * `wrangler.jsonc` is read directly, so the bindings under test are the ones that deploy.
 */

// Resolved from this file rather than from the working directory: vitest loads the config
// through a temporary file elsewhere, so a relative path is relative to nothing
// predictable. The real `migrations/` directory is used, so the schema under test cannot
// drift from the schema that ships; `test/setup.ts` applies it to each isolated database.
const migrations = await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url)));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { TEST_MIGRATIONS: migrations } }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"]
  }
});
