import { describe, it, expect } from "vitest";
import { newId, isShareId, idTimestamp, randomToken, sha256Hex } from "../src/ids.js";

describe("ids", () => {
  it("issues 26-character ULIDs the router accepts", () => {
    for (let i = 0; i < 200; i++) {
      const id = newId();
      expect(id).toMatch(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
      expect(isShareId(id)).toBe(true);
    }
  });

  it("carries its creation time in the first ten characters", () => {
    const now = Date.UTC(2026, 8, 30, 12, 34, 56, 789);
    expect(idTimestamp(newId(now))).toBe(now);
  });

  it("matches the reference ULID encoding of a known timestamp", () => {
    // From the ULID spec's example: 1469918176385 ms encodes as 01ARYZ6S41.
    expect(newId(1469918176385).slice(0, 10)).toBe("01ARYZ6S41");
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newId(0)));
    expect(ids.size).toBe(1000);
  });

  /**
   * 26 characters hold 130 bits and a ULID has 128, so a first character above 7 spells
   * an id this service could not have issued — and without the bound one share would
   * answer to several URLs.
   */
  it("rejects anything that is not a canonical upper-case ULID", () => {
    const id = newId();
    expect(isShareId(id.toLowerCase())).toBe(false);
    expect(isShareId(`8${id.slice(1)}`)).toBe(false);
    expect(isShareId(id.slice(1))).toBe(false);
    expect(isShareId(`${id}0`)).toBe(false);
    expect(isShareId(`${id.slice(0, 25)}U`)).toBe(false); // not in Crockford's alphabet
    expect(isShareId(undefined)).toBe(false);
  });

  it("makes delete tokens that are random and hashes that are stable", async () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
