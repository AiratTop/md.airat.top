/**
 * The three representations of a share, each at its own URL (as in orator-space: one
 * document, one address per format, one cache key each):
 *
 *   /{id}        the page — the static shell with the document embedded
 *   /{id}.md     the markdown exactly as it was shared
 *   /{id}.json   the markdown plus its metadata
 *
 * Every read is side-effect free, so a chat client unfurling the link changes nothing.
 * "Never existed", "expired" and "deleted" are one 404: telling them apart would make
 * these URLs an oracle for which ids were ever issued.
 */

import { getShare } from "./db.js";
import { shareLinks } from "./links.js";
import { json, text, withShareHeaders } from "./http.js";

const FALLBACK_TITLE = "Shared markdown";
const MAX_TITLE_LENGTH = 90;

/**
 * A title for the page and for link previews: the first heading, else the first line
 * with text in it, with the markdown punctuation taken off.
 */
export function shareTitle(content) {
  const heading = /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m.exec(content);
  const line = heading ? heading[1] : content.split("\n").find((candidate) => /[\p{L}\p{N}]/u.test(candidate)) ?? "";

  const plain = line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links and images keep their text
    .replace(/<[^>]*>/g, "")
    .replace(/[*_`~#>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return FALLBACK_TITLE;
  return plain.length > MAX_TITLE_LENGTH ? `${plain.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…` : plain;
}

/**
 * JSON inside a <script> element ends at the first `</script`, whatever the JSON parser
 * would have thought. Escaping `<` (and `>` and `&` while at it) keeps the document's
 * text from closing the element it is carried in.
 */
function embeddable(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function isoDates(share) {
  return { createdAt: new Date(share.createdAt).toISOString(), expiresAt: new Date(share.expiresAt).toISOString() };
}

/** @param {string} id @param {"page" | "md" | "json"} format */
export async function serveShare(request, env, id, format) {
  const share = await getShare(env.DB, id, Date.now());
  const links = shareLinks(env, id);

  if (format === "md") {
    if (!share) return text("Not found. Shared links are deleted after 24 hours.\n", 404);
    return text(share.content, 200, {
      "Content-Disposition": `inline; filename="${id}.md"`,
      "Access-Control-Allow-Origin": "*",
      Link: `<${links.url}>; rel="canonical"`
    });
  }

  if (format === "json") {
    if (!share) return json({ error: "Not found. Shared links are deleted after 24 hours.", code: "gone" }, 404);
    return json(
      { id, ...links, title: shareTitle(share.content), sizeBytes: share.sizeBytes, ...isoDates(share), content: share.content },
      200,
      { "Access-Control-Allow-Origin": "*", Link: `<${links.url}>; rel="canonical"` }
    );
  }

  const shellUrl = new URL(request.url);
  shellUrl.pathname = "/view.html";
  const shell = await env.ASSETS.fetch(new Request(shellUrl, { method: "GET" }));

  const title = share ? shareTitle(share.content) : "Link expired";
  const data = share ? { id, ...links, sizeBytes: share.sizeBytes, ...isoDates(share), content: share.content } : null;

  const rewritten = new HTMLRewriter()
    .on("title", { element: (el) => void el.setInnerContent(`${title} — md.airat.top`) })
    .on('meta[property="og:title"]', { element: (el) => void el.setAttribute("content", title) })
    .on('meta[name="twitter:title"]', { element: (el) => void el.setAttribute("content", title) })
    .on('meta[property="og:url"]', { element: (el) => void el.setAttribute("content", links.url) })
    .on("link#alternate-md", { element: (el) => void (share ? el.setAttribute("href", links.markdownUrl) : el.remove()) })
    .on("link#alternate-json", { element: (el) => void (share ? el.setAttribute("href", links.jsonUrl) : el.remove()) })
    .on("script#share-data", { element: (el) => void el.setInnerContent(embeddable(data), { html: true }) })
    .transform(shell);

  return withShareHeaders(rewritten, share ? 200 : 404);
}
