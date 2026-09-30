/**
 * The unit a rate limit counts: one IPv4 address, or one IPv6 /64.
 *
 * Counting IPv6 per address counts nothing. A /64 is the smallest block a network hands
 * to a single subscriber, which is 2^64 addresses one caller can rotate through, one
 * request each, and every one of them arrives with a fresh allowance.
 *
 * IPv4-mapped IPv6 (`::ffff:192.0.2.1`) is counted as the IPv4 address it carries.
 */
export function rateLimitBucket(address) {
  if (!address.includes(":")) return address;

  const [head, tail] = address.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];

  const last = (tail === undefined ? left : right).at(-1) ?? "";
  if (last.includes(".")) return last;

  const groups = tail === undefined ? left : [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((group) => (parseInt(group, 16) || 0).toString(16));
  return `${prefix.join(":")}::/64`;
}
