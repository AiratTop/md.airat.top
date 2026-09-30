/**
 * Every D1 statement this Worker runs.
 *
 * Kept in one file so the invariant that matters — a share is never served after it
 * expires — lives in exactly one place: every read carries `expires_at > ?`.
 */

export async function insertShare(db, share) {
  await db
    .prepare(
      `INSERT INTO shares (id, content, size_bytes, created_at, expires_at, delete_token_hash)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(share.id, share.content, share.sizeBytes, share.createdAt, share.expiresAt, share.deleteTokenHash)
    .run();
}

/** The share, or null when it does not exist or has expired — deliberately one answer. */
export async function getShare(db, id, now) {
  const row = await db
    .prepare(
      `SELECT id, content, size_bytes, created_at, expires_at
         FROM shares
        WHERE id = ? AND expires_at > ?`
    )
    .bind(id, now)
    .first();

  if (!row) return null;
  return {
    id: /** @type {string} */ (row.id),
    content: /** @type {string} */ (row.content),
    sizeBytes: /** @type {number} */ (row.size_bytes),
    createdAt: /** @type {number} */ (row.created_at),
    expiresAt: /** @type {number} */ (row.expires_at)
  };
}

/**
 * Early deletion by the creator. The hash is compared inside the DELETE, so a wrong
 * token changes nothing. Returns whether a row was removed.
 */
export async function deleteShare(db, id, deleteTokenHash) {
  const result = await db
    .prepare(`DELETE FROM shares WHERE id = ? AND delete_token_hash = ?`)
    .bind(id, deleteTokenHash)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

/**
 * The cron sweep. Housekeeping rather than a correctness guarantee — an expired row is
 * already invisible to every read before it is deleted.
 */
export async function deleteExpired(db, now, limit = 1000) {
  const result = await db
    .prepare(`DELETE FROM shares WHERE id IN (SELECT id FROM shares WHERE expires_at <= ? LIMIT ?)`)
    .bind(now, limit)
    .run();
  return result.meta?.changes ?? 0;
}
