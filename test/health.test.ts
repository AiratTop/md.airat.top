import { describe, it, expect, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index.js";
import { resetHealthCache } from "../src/health.js";
import { BASE, call, readJson } from "./helpers.js";

/** A database that takes its time, and counts how often it was asked. */
function slowDatabase(delayMs = 40, fail = false) {
  let queries = 0;
  return {
    get queries() {
      return queries;
    },
    binding: {
      prepare() {
        queries += 1;
        return {
          async first() {
            await scheduler.wait(delayMs);
            if (fail) throw new Error("D1 unavailable");
            return null;
          }
        };
      }
    }
  };
}

function probe(probeEnv: any, ctx: ExecutionContext) {
  return worker.fetch(new Request(`${BASE}/health`), probeEnv, ctx) as Promise<Response>;
}

beforeEach(() => {
  // The cache lives for the isolate, which every test in this run shares.
  resetHealthCache();
});

describe("health", () => {
  it("reports ok when the schema is there", async () => {
    const response = await call("/health");
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ status: "ok", database: "ok" });
  });

  it("reports 503 when the database cannot be reached", async () => {
    const db = slowDatabase(1, true);
    const ctx = createExecutionContext();
    const response = await probe({ ...env, DB: db.binding }, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(503);
    expect(await readJson(response)).toEqual({ status: "degraded", database: "unavailable" });
  });

  /**
   * The stampede a cache alone does not prevent: it is filled once the query returns, so
   * everything arriving while the first query is in flight passes the same empty cache
   * and starts a query of its own. `/health` is ahead of the rate limiter — a status
   * checker that gets a 429 reports an outage that is not happening — so this was the one
   * path that turned request volume into database load.
   */
  it("asks the database once when a hundred probes arrive together", async () => {
    const db = slowDatabase();
    const probeEnv = { ...env, DB: db.binding };
    const ctx = createExecutionContext();

    const responses = await Promise.all(Array.from({ length: 100 }, () => probe(probeEnv, ctx)));
    await waitOnExecutionContext(ctx);

    expect(db.queries).toBe(1);
    for (const response of responses) expect(response.status).toBe(200);
  });

  it("serves the cached answer without asking again", async () => {
    const db = slowDatabase(1);
    const probeEnv = { ...env, DB: db.binding };
    const ctx = createExecutionContext();

    for (let i = 0; i < 20; i++) await probe(probeEnv, ctx);
    await waitOnExecutionContext(ctx);

    expect(db.queries).toBe(1);
  });

  it("caches the failure too, so an outage cannot be turned into load", async () => {
    const db = slowDatabase(1, true);
    const probeEnv = { ...env, DB: db.binding };
    const ctx = createExecutionContext();

    const responses = await Promise.all(Array.from({ length: 50 }, () => probe(probeEnv, ctx)));
    await waitOnExecutionContext(ctx);

    expect(db.queries).toBe(1);
    for (const response of responses) expect(response.status).toBe(503);
  });
});
