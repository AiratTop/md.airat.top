import { describe, it, expect } from "vitest";
import { call } from "./helpers.js";
import { DEFAULT_TTL, MAX_CONTENT_BYTES, SHARE_TTLS } from "../src/limits.js";

describe("limits", () => {
  /** The editor refuses before uploading; the two numbers drifting apart is how it starts lying. */
  it("the editor checks the same size cap as the API", async () => {
    const source = await (await call("/app.js")).text();
    const match = /const MAX_SHARE_BYTES = (\d+) \* (\d+);/.exec(source);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * Number(match![2])).toBe(MAX_CONTENT_BYTES);
  });

  /** A radio the API does not know would fail every share made with it. */
  it("the share dialog offers exactly the API's lifetimes, starting at its default", async () => {
    const html = await (await call("/")).text();
    const offered = [...html.matchAll(/<input type="radio" name="shareTtl" value="([^"]+)"( checked)?/g)];
    expect(offered.map((m) => m[1])).toEqual(Object.keys(SHARE_TTLS));
    expect(offered.filter((m) => m[2]).map((m) => m[1])).toEqual([DEFAULT_TTL]);

    const source = await (await call("/app.js")).text();
    expect(/const DEFAULT_SHARE_TTL = "([^"]+)";/.exec(source)?.[1]).toBe(DEFAULT_TTL);
  });
});
