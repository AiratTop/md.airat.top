/**
 * The numbers, in one place. `public_html/app.js` repeats MAX_CONTENT_BYTES so it can
 * refuse before uploading; `test/limits.test.ts` fails when the two disagree.
 */

/** How long a share lives. Fixed rather than chosen: this is for passing a document on,
 *  not for keeping one. */
export const SHARE_TTL_MS = 24 * 60 * 60 * 1000;

/** UTF-8 bytes of markdown. A long README is 30–60 KB; this leaves room for a big one. */
export const MAX_CONTENT_BYTES = 256 * 1024;

/**
 * Flood protection for creating shares, per caller. The minute window stops a burst, the
 * day window stops a patient script: at the cap, one address can hold at most
 * 300 × 256 KB ≈ 75 MB, and all of it is gone a day later. The minute window was 10 until
 * it proved too tight for a few people behind one address, or for the browser suite run
 * twice in a row (it creates six shares).
 */
export const RATE_LIMITS = {
  writeMinute: { limit: 30, periodSeconds: 60 },
  writeDay: { limit: 300, periodSeconds: 86400 },
  other: { limit: 60, periodSeconds: 60 }
};

/**
 * How many rows one sweep may remove, and how many batches it may run. One unbounded
 * DELETE is what stalls a D1 after an outage or a flood.
 */
export const SWEEP_BATCH = 1000;
export const SWEEP_MAX_BATCHES = 10;
