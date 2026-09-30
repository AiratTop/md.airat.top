/**
 * The JSON API. Two verbs; reading a share goes through `/{id}.md` and `/{id}.json`.
 *
 *   POST   /api/shares        store a snapshot of markdown, get its links back
 *   DELETE /api/shares/{id}   the creator deletes it early (needs the delete token)
 */

import { newId, isShareId, randomToken, sha256Hex } from "./ids.js";
import { insertShare, deleteShare } from "./db.js";
import { json, error, readJson, MAX_BODY_BYTES } from "./http.js";
import { MAX_CONTENT_BYTES, SHARE_TTL_MS } from "./limits.js";
import { shareLinks } from "./links.js";

/**
 * Maps a refused body to its response, or returns the parsed body.
 *
 * @param {Request} request
 * @returns {Promise<{ ok: true, value: any } | { ok: false, response: Response }>}
 */
async function body(request) {
  const result = await readJson(request);
  if (result.ok) return { ok: true, value: result.body };

  if (result.reason === "size") {
    return { ok: false, response: error(`Request body must be at most ${MAX_BODY_BYTES} bytes.`, 413, "too_large") };
  }
  if (result.reason === "type") {
    return { ok: false, response: error("Content-Type must be application/json.", 415) };
  }
  return { ok: false, response: error("Malformed JSON body.", 400) };
}

async function handleCreate(request, env) {
  const parsed = await body(request);
  if (!parsed.ok) return parsed.response;

  const content = parsed.value.content;
  if (typeof content !== "string" || content.trim() === "") {
    return error("content must be a non-empty string of markdown.", 400);
  }
  const sizeBytes = new TextEncoder().encode(content).byteLength;
  if (sizeBytes > MAX_CONTENT_BYTES) {
    return error(`content must be at most ${MAX_CONTENT_BYTES} bytes of UTF-8.`, 413, "too_large");
  }

  const now = Date.now();
  const deleteToken = randomToken();
  const share = {
    id: newId(now),
    content,
    sizeBytes,
    createdAt: now,
    expiresAt: now + SHARE_TTL_MS,
    deleteTokenHash: await sha256Hex(deleteToken)
  };

  await insertShare(env.DB, share);

  // The delete token is returned here and never again: only its hash is stored.
  return json(
    {
      id: share.id,
      ...shareLinks(env, share.id),
      sizeBytes,
      createdAt: new Date(share.createdAt).toISOString(),
      expiresAt: new Date(share.expiresAt).toISOString(),
      deleteToken
    },
    201
  );
}

async function handleDelete(request, id, env) {
  const parsed = await body(request);
  if (!parsed.ok) return parsed.response;

  const token = parsed.value.deleteToken;
  if (typeof token !== "string" || token.length === 0 || token.length > 128) {
    return error("A deleteToken is required to delete a share.", 400);
  }

  const deleted = await deleteShare(env.DB, id, await sha256Hex(token));
  if (!deleted) return error("This share does not exist or the delete token is wrong.", 404, "gone");
  return json({ deleted: true });
}

/**
 * Routes anything under `/api/`. Returns null when the path is not ours.
 *
 * @param {Request} request
 * @param {Env} env
 * @param {URL} url
 */
export function routeApi(request, env, url) {
  const path = url.pathname;

  if (path === "/api/shares") {
    if (request.method !== "POST") return error("Method not allowed.", 405);
    return handleCreate(request, env);
  }

  const match = /^\/api\/shares\/([^/]+)$/.exec(path);
  if (!match) return null;

  // An id this service could not have issued costs a regex, not a database round trip.
  if (!isShareId(match[1])) return error("Not a valid share id.", 404, "gone");
  if (request.method === "DELETE") return handleDelete(request, match[1], env);
  return error("Method not allowed.", 405);
}
