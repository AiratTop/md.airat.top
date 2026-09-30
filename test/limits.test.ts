import { describe, it, expect } from "vitest";
import { call } from "./helpers.js";
import { MAX_CONTENT_BYTES } from "../src/limits.js";

describe("limits", () => {
  /** The editor refuses before uploading; the two numbers drifting apart is how it starts lying. */
  it("the editor checks the same size cap as the API", async () => {
    const source = await (await call("/app.js")).text();
    const match = /const MAX_SHARE_BYTES = (\d+) \* (\d+);/.exec(source);
    expect(match).not.toBeNull();
    expect(Number(match![1]) * Number(match![2])).toBe(MAX_CONTENT_BYTES);
  });
});
