/**
 * `/{id}.html` — the share rendered on the server, for anything that wants HTML without
 * running a browser: curl, a script, a model.
 *
 * The markdown dialect is the editor's own (src/markdown.js). There is no DOMPurify here
 * — it needs a browser's DOM — so the output is cleaned with HTMLRewriter against an
 * allowlist of tags and attributes, and served under a policy that runs no script at
 * all. Math is rendered with KaTeX into its placeholders after cleaning, for the same
 * reason as in the browser: KaTeX's inline styles would not survive the cleaning, and
 * the author's must not. Diagrams need a browser, so they stay as their source.
 */

import katex from "katex";
import { createMarkdown, escapeHtml } from "./markdown.js";

const md = createMarkdown();

/** Removed together with everything inside them. */
const DROPPED = new Set([
  "script", "style", "template", "iframe", "frame", "frameset", "object", "embed", "applet",
  "noscript", "noembed", "noframes", "plaintext", "xmp", "svg", "math", "title", "head", "meta",
  "link", "base", "form", "textarea", "select", "option", "button", "input", "canvas", "audio",
  "video", "source", "track", "dialog", "portal"
]);

/** Kept. Any other tag is unwrapped: the tag goes, its content stays. */
const ALLOWED = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "caption", "cite", "code", "col",
  "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "li", "mark", "ol", "p",
  "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "span", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul",
  "var", "wbr"
]);

const GLOBAL_ATTRIBUTES = new Set(["class", "id", "title", "lang", "dir", "role"]);
const TAG_ATTRIBUTES = {
  a: ["href", "name"],
  img: ["src", "alt", "width", "height", "loading"],
  td: ["colspan", "rowspan", "align"],
  th: ["colspan", "rowspan", "align", "scope"],
  col: ["span"],
  colgroup: ["span"],
  ol: ["start", "reversed", "type"],
  li: ["value"],
  details: ["open"],
  time: ["datetime"],
  p: ["align"],
  div: ["align"],
  q: ["cite"],
  blockquote: ["cite"]
};
const URL_ATTRIBUTES = new Set(["href", "src", "cite"]);

/**
 * A numeric character reference as a browser reads it: zero, a surrogate or anything past
 * U+10FFFF is U+FFFD rather than an exception (`&#x110000;` once made /{id}.html a 500).
 */
function codePoint(number) {
  const valid = number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff);
  return String.fromCodePoint(valid ? number : 0xfffd);
}

/** The few entities that matter for reading a URL's scheme; see safeUrl. */
function decodeEntities(value) {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot|apos|colon|tab|newline);/gi, (_, name) =>
      ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", colon: ":", tab: "\t", newline: "\n" })[name.toLowerCase()]
    );
}

/**
 * http, https, mailto, in-page and relative links, and raster data: URLs for images.
 * HTMLRewriter hands attribute values over undecoded, and a browser decodes them, so the
 * check runs on the decoded value; a scheme still holding an entity is refused outright.
 */
function safeUrl(value, attribute) {
  const decoded = decodeEntities(value).trim();
  const scheme = decoded.split(/[/?#]/, 1)[0];
  if (scheme.includes("&")) return false;
  if (decoded.startsWith("#")) return true;
  if (attribute === "src" && /^data:image\/(png|gif|jpeg|webp);/i.test(decoded)) return true;
  let url;
  try {
    url = new URL(decoded, "https://md.airat.top/");
  } catch {
    return false;
  }
  return ["http:", "https:", "mailto:"].includes(url.protocol);
}

function attributeAllowed(tag, name, value) {
  if (URL_ATTRIBUTES.has(name) && (TAG_ATTRIBUTES[tag] ?? []).includes(name)) return safeUrl(value, name);
  if (GLOBAL_ATTRIBUTES.has(name) || name.startsWith("aria-")) return true;
  return (TAG_ATTRIBUTES[tag] ?? []).includes(name);
}

const decodeTex = (value) =>
  value.replace(/&#(\d+);/g, (_, dec) => codePoint(Number(dec)))
    .replace(/&(amp|lt|gt|quot);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[name]);

/**
 * Markdown → the cleaned HTML fragment, math rendered. Exported for the tests.
 * @param {string} markdown
 */
export async function renderHtmlFragment(markdown) {
  let tex = "";
  let hasMath = false;

  const rewriter = new HTMLRewriter()
    .onDocument({ comments: (comment) => void comment.remove() })
    .on("*", {
      element(element) {
        const tag = element.tagName.toLowerCase();
        if (DROPPED.has(tag)) {
          element.remove();
          return;
        }
        if (!ALLOWED.has(tag)) {
          element.removeAndKeepContent();
          return;
        }
        // Copied first: removing an attribute while iterating the live list throws. (The
        // cast: the DOM typings in scope describe a different `attributes`.)
        const attributes = [.../** @type {Iterable<[string, string]>} */ (/** @type {unknown} */ (element.attributes))];
        for (const [name, value] of attributes) {
          if (!attributeAllowed(tag, name.toLowerCase(), value)) element.removeAttribute(name);
        }
        if (tag === "a" && !(element.getAttribute("href") ?? "#").startsWith("#")) {
          element.setAttribute("rel", "noopener noreferrer nofollow ugc");
        }
      }
    })
    // The TeX in a placeholder is text the cleaning has already seen. It is collected,
    // and KaTeX's rendering goes in after it — inserted content is not rewritten again,
    // so KaTeX's own inline styles survive while the author's never could.
    .on(".math-tex", {
      element(element) {
        tex = "";
        const displayMode = (element.getAttribute("class") ?? "").split(/\s+/).includes("is-display");
        element.onEndTag((end) => {
          hasMath = true;
          const html = katex.renderToString(decodeTex(tex), {
            displayMode,
            throwOnError: false,
            trust: false,
            strict: "ignore",
            maxSize: 20,
            maxExpand: 500,
            output: "htmlAndMathml"
          });
          end.before(html, { html: true });
        });
      },
      text(chunk) {
        tex += chunk.text;
        chunk.remove();
      }
    });

  const html = await rewriter.transform(new Response(md.render(markdown))).text();
  return { html, hasMath };
}

/**
 * The whole page: a light document in this site's styles, no script.
 * @param {{ id: string, content: string, title: string, url: string }} share
 */
export async function renderHtmlDocument(share) {
  const { html, hasMath } = await renderHtmlFragment(share.content);
  const stylesheets = ["/vendor/highlight.css", ...(hasMath ? ["/vendor/katex/katex.css"] : []), "/styles.css"];
  return `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="generator" content="md.airat.top">
<title>${escapeHtml(share.title)}</title>
<link rel="canonical" href="${escapeHtml(share.url)}">
${stylesheets.map((href) => `<link rel="stylesheet" href="${href}">`).join("\n")}
</head>
<body class="export-page">
<main class="preview export-document">
${html}
</main>
</body>
</html>
`;
}

/**
 * The policy for /{id}.html: no script of any kind, styles and fonts from this site
 * (plus KaTeX's inline styles), images as in the editor, no forms, no frames, no <base>.
 */
export const HTML_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");
