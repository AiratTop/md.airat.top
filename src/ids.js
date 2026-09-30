/**
 * Identifiers: ULID — 48 bits of millisecond timestamp and 80 random bits, written as 26
 * characters of Crockford base32:
 *
 *   https://md.airat.top/01K6BZ4Q8S0YV4N3X9JQ7M2T5R
 *
 * Crockford because the alphabet is case-insensitive and has no look-alike characters,
 * which is what a link pasted into a chat needs. 80 random bits because the link is the
 * only access control a share has: an id that can be enumerated is a document anyone can
 * read.
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ID_LENGTH = 26;

/**
 * 26 characters carry 130 bits and a ULID has 128, so the first character is at most
 * `7`. Without that bound one ULID would have four spellings and `/{id}` would answer to
 * all of them — a cache-key problem and a canonical-URL problem at once.
 */
const ID_PATTERN = new RegExp(`^[0-7][${CROCKFORD}]{${ID_LENGTH - 1}}$`);

/** Could this service have issued this id? Upper case only; the router redirects the rest. */
export function isShareId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

/** A fresh ULID. */
export function newId(now = Date.now()) {
  const random = new Uint8Array(10);
  crypto.getRandomValues(random);

  let value = BigInt(now) & 0xffffffffffffn;
  for (const byte of random) value = (value << 8n) | BigInt(byte);

  const out = new Array(ID_LENGTH);
  for (let i = ID_LENGTH - 1; i >= 0; i--) {
    out[i] = CROCKFORD[Number(value & 31n)];
    value >>= 5n;
  }
  return out.join("");
}

/** Milliseconds since epoch, read back out of the first ten characters. */
export function idTimestamp(id) {
  let ms = 0;
  for (const char of id.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(char);
  return ms;
}

/** base64url randomness — the delete token. */
export function randomToken(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 as lowercase hex. The delete token is stored only as this. */
export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
