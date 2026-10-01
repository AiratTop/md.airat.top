// Markdown → safe HTML, shared by the editor and the shared-document page.
//
// The markdown dialect itself lives in src/markdown.js, shared with the Worker's
// /{id}.html and bundled into vendor/markdown-kit.js (`npm run vendor`); KaTeX and mermaid
// load from vendor/ when a document needs them. The markdown on either page can be
// somebody else's — a shared document, or one opened from a share into the editor — so
// everything goes through DOMPurify before it reaches the DOM. Style is stripped as well
// as script, so a document cannot restyle the page around it into something that looks
// like part of the site.

const { md, escapeHtml } = MarkdownKit;

const USER_ID_PREFIX = "user-content-";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  // localName, not tagName: an SVG link (in a diagram) has the tagName "a", not "A".
  if (node.localName !== "a") {
    return;
  }
  const attribute = ["href", "xlink:href"].find((name) => node.hasAttribute(name));
  if (!attribute) {
    return;
  }
  const href = node.getAttribute(attribute);
  if (href.startsWith("#")) {
    // Ids in the document are prefixed (see below); in-page links — footnotes, a table
    // of contents — follow them, and stay in the same tab.
    if (href.length > 1 && !href.startsWith(`#${USER_ID_PREFIX}`)) {
      node.setAttribute(attribute, `#${USER_ID_PREFIX}${href.slice(1)}`);
    }
    return;
  }
  node.setAttribute("target", "_blank");
  node.setAttribute("rel", "noopener noreferrer nofollow ugc");
});

// SANITIZE_NAMED_PROPS prefixes every id and name in the document with "user-content-".
// Without it, a document containing <a id="shareCreate"> is found by the page's own
// getElementById("shareCreate") — it comes first in the DOM — and a click on it
// published the draft with no dialog. The pages also look their controls up before any
// markdown is rendered, and inside their own containers; this closes the class of bug
// rather than the one instance.
const renderMarkdown = (markdown) =>
  DOMPurify.sanitize(md.render(markdown), {
    // USE_PROFILES, plural: DOMPurify ignores any other spelling and falls back to its
    // default allowlist, which lets <svg> and <math> in.
    USE_PROFILES: { html: true },
    SANITIZE_NAMED_PROPS: true,
    // template: inert, but no use in a document, and /{id}.html drops it too.
    FORBID_TAGS: ["style", "template", "form", "input", "button", "textarea", "select", "option"],
    FORBID_ATTR: ["style"],
  });

// ---- Diagrams -----------------------------------------------------------------------
//
// Mermaid is large, so it loads only when a document has a diagram, and only the chunks
// for the diagram types in it. securityLevel "strict" turns off click handlers and
// scripts in diagrams, and the SVG it produces goes through DOMPurify like everything
// else. Labels are SVG text rather than HTML in a <foreignObject>, which the sanitiser
// would remove.

let mermaidLoading = null;
const diagramCache = new Map();
let diagramCount = 0;

const loadMermaid = () => {
  mermaidLoading ??= import("/vendor/mermaid/mermaid.js").then((module) => module.default);
  return mermaidLoading;
};

// `theme` forces "default" (light) or "dark"; by default diagrams follow the page.
const renderDiagrams = async (container, { theme: forcedTheme } = {}) => {
  const blocks = [...container.querySelectorAll("pre.mermaid-source")];
  if (!blocks.length) {
    return;
  }
  const mermaid = await loadMermaid();
  const theme = forcedTheme ?? (document.documentElement.dataset.theme === "dark" ? "dark" : "default");
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme,
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    suppressErrorRendering: true,
    // Settings a diagram's own %%{init}%% directive may not change. The first six are
    // mermaid's defaults; themeCSS and htmlLabels are added — CSS from a document stays
    // out, and labels stay SVG text that survives sanitising.
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "themeCSS", "htmlLabels"],
  });

  for (const block of blocks) {
    const source = block.textContent;
    const key = `${theme}\n${source}`;
    let svg = diagramCache.get(key);
    if (svg === undefined) {
      try {
        const result = await mermaid.render(`mermaid-diagram-${++diagramCount}`, source);
        svg = DOMPurify.sanitize(result.svg, { USE_PROFILES: { svg: true, svgFilters: true } });
      } catch (error) {
        svg = null;
      }
      diagramCache.set(key, svg);
    }
    // The preview may have been re-rendered while mermaid worked.
    if (!block.isConnected) continue;
    if (!svg) {
      block.classList.add("is-invalid");
      block.title = "This diagram could not be drawn. Check its mermaid syntax.";
      continue;
    }
    const figure = document.createElement("div");
    figure.className = "mermaid-diagram";
    figure.innerHTML = svg;
    block.replaceWith(figure);
  }
};

// ---- Math ---------------------------------------------------------------------------
//
// KaTeX positions every glyph with inline styles, and the sanitiser removes style
// attributes so that a document cannot restyle the page. So KaTeX never renders into
// the HTML that gets sanitised: the parser leaves the TeX as plain text in a
// placeholder, DOMPurify treats it like any other text, and KaTeX renders into the
// placeholder afterwards. Every style it writes then comes from KaTeX, computed from
// TeX, not from the author. trust:false keeps out \href, \url, \htmlStyle and the
// like; maxSize and maxExpand bound what a formula can make KaTeX draw or expand.

let katexLoading = null;
// Resolves once KaTeX's stylesheet has loaded (or failed): printing waits for it.
let katexStyled = Promise.resolve();

const loadKatex = () => {
  if (!katexLoading) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/vendor/katex/katex.css";
    katexStyled = new Promise((resolve) => {
      stylesheet.addEventListener("load", resolve, { once: true });
      stylesheet.addEventListener("error", resolve, { once: true });
    });
    document.head.append(stylesheet);
    katexLoading = import("/vendor/katex/katex.js").then((module) => module.default);
  }
  return katexLoading;
};

const renderMath = async (container) => {
  const nodes = [...container.querySelectorAll(".math-tex:not(.is-rendered)")];
  if (!nodes.length) {
    return;
  }
  const katex = await loadKatex();
  for (const node of nodes) {
    if (!node.isConnected) continue;
    katex.render(node.textContent, node, {
      displayMode: node.classList.contains("is-display"),
      throwOnError: false,
      trust: false,
      strict: "ignore",
      maxSize: 20,
      maxExpand: 500,
      output: "htmlAndMathml",
    });
    node.classList.add("is-rendered");
  }
};
