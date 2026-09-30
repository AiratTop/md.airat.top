// The markdown dialect of md.airat.top, in one place for both renderers: the browser
// (bundled into public_html/vendor/markdown-kit.js by `npm run vendor`) and the Worker,
// which serves /{id}.html. Output is unsanitised HTML with two kinds of placeholder —
// `.math-tex` holds TeX as text and `pre.mermaid-source` holds diagram source — that each
// renderer fills in after it has sanitised, because KaTeX needs inline styles and mermaid
// needs a browser.
//
// After changing this file, run `npm run vendor`: the browser uses the bundled copy.

import MarkdownIt from "markdown-it";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import footnote from "markdown-it-footnote";
import { full as emoji } from "markdown-it-emoji";
import frontMatter from "markdown-it-front-matter";
import mark from "markdown-it-mark";
import ins from "markdown-it-ins";
import abbr from "markdown-it-abbr";
import deflist from "markdown-it-deflist";
import { dollarmathPlugin as math } from "markdown-it-dollarmath";
import alerts from "markdown-it-github-alerts";
import hljs from "highlight.js/lib/common";
import { load as loadYaml } from "js-yaml";

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

export function createMarkdown() {
  const md = new MarkdownIt({
    html: true, // raw HTML is allowed in; the sanitiser of each renderer decides what survives
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
    .use(sub)
    .use(sup)
    .use(footnote)
    .use(emoji)
    .use(mark)
    .use(ins)
    .use(abbr)
    .use(deflist)
    .use(alerts) // > [!NOTE], [!TIP], [!IMPORTANT], [!WARNING], [!CAUTION]
    .use(frontMatter, () => {})
    // Math: $inline$, $$display$$ and ```math fences. Conservative about dollars — no space
    // inside the delimiters, no digit next to them — so "$5 and $10" stays prose. The
    // plugin only parses: the TeX is rendered after sanitising (see the header).
    .use(math, {
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
    // The front-matter plugin stores the raw YAML in `meta`, typed for other tokens' use.
    const source = String(tokens[index].meta ?? "");
    let data = /** @type {any} */ (null);
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

  // Mermaid fences become a placeholder that the browser replaces with the drawing; until
  // then, where there is no browser (/{id}.html), and if it does not parse, the source
  // shows as code.
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
  // symbol rather than an <input>: the sanitisers remove every input, and with it the only
  // thing that told done from not done.
  md.core.ruler.after("inline", "task-lists", (state) => {
    const tokens = state.tokens;
    for (let i = 2; i < tokens.length; i++) {
      if (tokens[i].type !== "inline" || tokens[i - 2].type !== "list_item_open") continue;
      const children = tokens[i].children ?? [];
      const first = children[0];
      const match = first && first.type === "text" && /^\[([ xX])\][ \t]/.exec(first.content);
      if (!match) continue;
      const done = match[1] !== " ";
      const box = new state.Token("html_inline", "", 0);
      box.content = done
        ? '<span class="task-box is-done" role="img" aria-label="Done">☑</span> '
        : '<span class="task-box" role="img" aria-label="Not done">☐</span> ';
      first.content = first.content.slice(match[0].length);
      children.unshift(box);
    }
  });

  return md;
}
