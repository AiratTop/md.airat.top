import { describe, it, expect } from "vitest";
import { rateLimitBucket } from "../src/address.js";
import { RATE_LIMITS } from "../src/limits.js";
import { fromAddress } from "./helpers.js";

describe("rate-limit buckets", () => {
  it("counts IPv4 per address", () => {
    expect(rateLimitBucket("192.0.2.7")).toBe("192.0.2.7");
  });

  it("counts IPv6 per /64, however the address is spelled", () => {
    const bucket = "2001:db8:aa:1::/64";
    for (const address of [
      "2001:db8:aa:1::1",
      "2001:db8:aa:1:ffff:ffff:ffff:ffff",
      "2001:0DB8:00AA:0001:0:0:0:2",
      "2001:db8:aa:1:abcd::"
    ]) {
      expect(rateLimitBucket(address), address).toBe(bucket);
    }
    expect(rateLimitBucket("2001:db8:aa:2::1")).not.toBe(bucket);
    expect(rateLimitBucket("::1")).toBe("0:0:0:0::/64");
  });

  it("counts IPv4-mapped IPv6 as the IPv4 address", () => {
    expect(rateLimitBucket("::ffff:192.0.2.7")).toBe("192.0.2.7");
  });

  /** One subscriber holds a whole /64; rotating through it must not reset the allowance. */
  it("does not reset the limit for a caller rotating through its /64", async () => {
    const send = (i: number) =>
      fromAddress(`2001:db8:77:0::${i.toString(16)}`, "/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "# rotating" })
      });

    for (let i = 1; i <= RATE_LIMITS.writeMinute.limit; i++) expect((await send(i)).status).toBe(201);
    expect((await send(RATE_LIMITS.writeMinute.limit + 1)).status).toBe(429);
  });
});
