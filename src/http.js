/**
 * Response helpers and the request-body reader.
 *
 * `noindex` and `no-store` are on every response this Worker produces except the editor
 * page itself: a shared document must not end up in a search index or a shared cache,
 * and the safe default belongs here rather than in each handler that has to remember it.
 */

import { MAX_CONTENT_BYTES } from "./limits.js";

const HSTS = "max-age=63072000";

const SHARE_HEADERS = {
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Cache-Control": "no-store, max-age=0",
  // A shared document's URL is its only access control, and a link clicked inside the
  // document would otherwise hand that URL to whatever site it points at.
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": HSTS
};

/*
 * The shared page renders markdown somebody else wrote. It is sanitised with DOMPurify
 * before it touches the DOM (public_html/render.js); this policy is what keeps a
 * sanitiser bug from becoming script execution on this origin.
 *
 * Scripts and requests go to this origin only: no inline script, no third-party script
 * (the site carries no analytics). Images may come from any HTTPS host, because markdown
 * embeds them by URL. Nowhere to submit a form, no frames, no plugins, no <base>.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "upgrade-insecure-requests"
].join("; ");

/**
 * @param {unknown} data
 * @param {number} [status]
 * @param {Record<string, string>} [extraHeaders]
 */
export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SHARE_HEADERS, ...extraHeaders }
  });
}

/**
 * @param {string} message
 * @param {number} [status]
 * @param {string} [code]
 */
export function error(message, status = 400, code = undefined) {
  return json({ error: message, ...(code ? { code } : {}) }, status);
}

/**
 * @param {string} body
 * @param {number} [status]
 * @param {Record<string, string>} [extraHeaders]
 */
export function text(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...SHARE_HEADERS, ...extraHeaders }
  });
}

/** A redirect that carries the same headers as everything else. */
export function redirect(location, status = 301) {
  return new Response(null, { status, headers: { Location: location, ...SHARE_HEADERS } });
}

/** A shared document's page: the share headers plus the content policy. */
export function withShareHeaders(response, status = response.status) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SHARE_HEADERS)) headers.set(key, value);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  // The shell's validator, not this document's: every share would claim the same ETag.
  headers.delete("ETag");
  return new Response(response.body, { status, headers });
}

/**
 * The editor and its static files — the one set of responses allowed to be indexed and
 * cached. The editor renders markdown too, including a document opened from a share, so
 * it gets the same content policy.
 */
export function withPageHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Strict-Transport-Security", HSTS);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * JSON escaping inflates markdown a little (newlines, quotes, tabs) and control
 * characters a lot, so the body cap sits well above the content cap. The content cap is
 * enforced on the decoded string in api.js; this one only stops a request from being
 * buffered without limit.
 */
export const MAX_BODY_BYTES = 4 * MAX_CONTENT_BYTES;

/** Thrown-free body reader. Returns a reason instead of a body when it will not read one. */
export async function readJson(request) {
  // The media type is compared, not searched for: `text/plain;foo=application/json` is
  // CORS-safelisted, so a browser would send it cross-site without a preflight, and any
  // page on the web could make its visitors create shares here.
  const mediaType = (request.headers.get("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") return { ok: false, reason: "type" };

  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, reason: "size" };

  // A chunked request declares no length and a dishonest one declares the wrong length,
  // so the bytes are counted as they arrive.
  let body;
  try {
    body = await readCapped(request);
  } catch {
    return { ok: false, reason: "size" };
  }

  try {
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? { ok: true, body: parsed }
      : { ok: false, reason: "malformed" };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

async function readCapped(request) {
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let out = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError("body too large");
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
