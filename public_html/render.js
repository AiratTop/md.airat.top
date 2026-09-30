// Markdown → safe HTML, shared by the editor and the shared-document page.
//
// markdown-it with its official plugins, highlight.js for code, KaTeX for math and
// mermaid for diagrams, all from vendor/ (built by `npm run vendor`). The markdown on either page can be
// somebody else's — a shared document, or one opened from a share into the editor — so
// everything goes through DOMPurify before it reaches the DOM. Style is stripped as well
// as script, so a document cannot restyle the page around it into something that looks
// like part of the site.

const { MarkdownIt, plugins, hljs, loadYaml } = MarkdownKit;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

const md = new MarkdownIt({
  html: true, // raw HTML is allowed in, and DOMPurify decides what survives
  linkify: true,
  breaks: true,
  // Only when the fence names a language highlight.js knows, as GitHub does.
  highlight(code, info) {
    const language = info.trim().split(/\s+/)[0].toLowerCase();
    if (!language || !hljs.getLanguage(language)) {
      return "";
    }
    const html = hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return `<pre><code class="hljs language-${escapeHtml(language)}">${html}</code></pre>`;
  },
})
  .use(plugins.sub)
  .use(plugins.sup)
  .use(plugins.footnote)
  .use(plugins.emoji)
  .use(plugins.mark)
  .use(plugins.ins)
  .use(plugins.abbr)
  .use(plugins.deflist)
  .use(plugins.alerts) // > [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
  .use(plugins.frontMatter, () => {})
  // Math: $inline$, $$display$$ and ```math fences. Conservative about dollars — no space
  // inside the delimiters, no digit next to them — so "$5 and $10" stays prose. The
  // plugin only parses; see renderMath() for why the TeX is rendered after sanitising.
  .use(plugins.math, {
    allow_space: false,
    allow_digits: false,
    double_inline: true,
    allow_labels: false,
    renderer: (tex, { displayMode }) => mathPlaceholder(tex, displayMode),
  });

function mathPlaceholder(tex, displayMode) {
  return displayMode
    ? `<div class="math-tex is-display">${escapeHtml(tex)}</div>\n`
    : `<span class="math-tex">${escapeHtml(tex)}</span>`;
}

// Front matter shows as a one-row table, the way GitHub shows it. Anything that is not a
// plain mapping — a list, a scalar, YAML that does not parse — shows as the YAML itself.
const frontMatterCell = (value) => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(frontMatterCell).join(", ");
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  return escapeHtml(value);
};

md.renderer.rules.front_matter = (tokens, index) => {
  const source = tokens[index].meta;
  let data = null;
  try {
    data = loadYaml(source);
  } catch (error) {
    data = null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) {
    return `<pre class="front-matter"><code>${escapeHtml(source)}</code></pre>\n`;
  }
  const keys = Object.keys(data);
  return (
    `<table class="front-matter"><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead>` +
    `<tbody><tr>${keys.map((key) => `<td>${frontMatterCell(data[key])}</td>`).join("")}</tr></tbody></table>\n`
  );
};

// Mermaid fences become a placeholder that renderDiagrams() replaces with the drawing;
// until then, and if the diagram does not parse, the source shows as code.
const defaultFence = md.renderer.rules.fence;
md.renderer.rules.fence = (tokens, index, options, env, self) => {
  const token = tokens[index];
  const language = token.info.trim().split(/\s+/)[0].toLowerCase();
  if (language === "mermaid") {
    return `<pre class="mermaid-source"><code>${escapeHtml(token.content)}</code></pre>\n`;
  }
  if (language === "math") {
    return mathPlaceholder(token.content, true);
  }
  return defaultFence(tokens, index, options, env, self);
};

// Task lists ("- [ ]" / "- [x]"), which markdown-it leaves to plugins. They render as a
// symbol rather than an <input>: DOMPurify removes every input, and with it the only
// thing that told done from not done.
md.core.ruler.after("inline", "task-lists", (state) => {
  const tokens = state.tokens;
  for (let i = 2; i < tokens.length; i++) {
    if (tokens[i].type !== "inline" || tokens[i - 2].type !== "list_item_open") continue;
    const first = tokens[i].children[0];
    const match = first && first.type === "text" && /^\[([ xX])\][ \t]/.exec(first.content);
    if (!match) continue;
    const done = match[1] !== " ";
    const box = new state.Token("html_inline", "", 0);
    box.content = done
      ? '<span class="task-box is-done" role="img" aria-label="Done">☑</span> '
      : '<span class="task-box" role="img" aria-label="Not done">☐</span> ';
    first.content = first.content.slice(match[0].length);
    tokens[i].children.unshift(box);
  }
});

const USER_ID_PREFIX = "user-content-";

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName !== "A" || !node.hasAttribute("href")) {
    return;
  }
  const href = node.getAttribute("href");
  if (href.startsWith("#")) {
    // Ids in the document are prefixed (see below); in-page links — footnotes, a table
    // of contents — follow them, and stay in the same tab.
    if (href.length > 1 && !href.startsWith(`#${USER_ID_PREFIX}`)) {
      node.setAttribute("href", `#${USER_ID_PREFIX}${href.slice(1)}`);
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
    USE_PROFILE: { html: true },
    SANITIZE_NAMED_PROPS: true,
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select", "option"],
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
        svg = DOMPurify.sanitize(result.svg, { USE_PROFILE: { svg: true, svgFilters: true } });
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

const loadKatex = () => {
  if (!katexLoading) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = "/vendor/katex/katex.css";
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
