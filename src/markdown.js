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

// Bounds on the front-matter table (see frontMatterTable): far past any real front matter,
// far short of what YAML aliases can expand into.
const FRONT_MATTER_MAX_DEPTH = 32;
const FRONT_MATTER_MAX_VALUES = 10_000;
const FRONT_MATTER_MAX_CHARACTERS = 100_000;

class FrontMatterTooLarge extends Error {}

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
  //
  // The YAML is someone else's, and YAML aliases make it a graph rather than a tree: an
  // alias can refer to its own ancestor (`a: &a [*a]`), and a few lines of nested aliases
  // expand into millions of values. So the table is written with a budget — depth, values
  // and characters — and a cycle or an exhausted budget shows the YAML as written instead.
  const frontMatterTable = (data) => {
    let values = 0;
    let characters = 0;
    const ancestors = new Set();
    const spend = (text) => {
      characters += text.length;
      if (characters > FRONT_MATTER_MAX_CHARACTERS) throw new FrontMatterTooLarge();
      return text;
    };
    // Nested values are written as JSON; the cell's own list is written comma-separated.
    const write = (value, depth, json) => {
      if (++values > FRONT_MATTER_MAX_VALUES || depth > FRONT_MATTER_MAX_DEPTH) throw new FrontMatterTooLarge();
      if (value === null || value === undefined) return spend(json ? "null" : "");
      if (value instanceof Date) {
        const date = Number.isNaN(value.getTime()) ? "" : value.toISOString();
        return spend(json ? JSON.stringify(date) : date.slice(0, 10));
      }
      if (typeof value !== "object") return spend(json ? JSON.stringify(value) ?? "null" : String(value));
      if (ancestors.has(value)) throw new FrontMatterTooLarge();
      ancestors.add(value);
      let text;
      if (Array.isArray(value)) {
        const items = value.map((item) => write(item, depth + 1, json));
        text = json ? `[${items.join(",")}]` : items.join(", ");
      } else {
        const entries = Object.keys(value).map((key) => `${spend(JSON.stringify(key))}:${write(value[key], depth + 1, true)}`);
        text = `{${entries.join(",")}}`;
      }
      ancestors.delete(value);
      return text;
    };
    const keys = Object.keys(data);
    const cells = keys.map((key) => write(data[key], 0, false));
    return (
      `<table class="front-matter"><thead><tr>${keys.map((key) => `<th>${escapeHtml(key)}</th>`).join("")}</tr></thead>` +
      `<tbody><tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr></tbody></table>\n`
    );
  };

  md.renderer.rules.front_matter = (tokens, index) => {
    // The front-matter plugin stores the raw YAML in `meta`, typed for other tokens' use.
    const source = String(tokens[index].meta ?? "");
    const asWritten = `<pre class="front-matter"><code>${escapeHtml(source)}</code></pre>\n`;
    let data = /** @type {any} */ (null);
    try {
      data = loadYaml(source);
    } catch (error) {
      data = null;
    }
    if (!data || typeof data !== "object" || Array.isArray(data) || !Object.keys(data).length) {
      return asWritten;
    }
    try {
      return frontMatterTable(data);
    } catch (error) {
      if (error instanceof FrontMatterTooLarge) return asWritten;
      throw error;
    }
  };

  // Table alignment (`:---:`) comes out of markdown-it as style="text-align:…", which both
  // sanitisers strip along with every other style. It becomes the `align` attribute, which
  // both keep and styles.css honours; any other style on a cell is dropped here.
  for (const rule of ["th_open", "td_open"]) {
    md.renderer.rules[rule] = (tokens, index, options, env, self) => {
      const token = tokens[index];
      const alignment = /^text-align:(left|center|right)$/.exec(String(token.attrGet("style") ?? ""));
      if (token.attrs) token.attrs = token.attrs.filter(([name]) => name !== "style");
      if (alignment) token.attrSet("align", alignment[1]);
      return self.renderToken(tokens, index, options);
    };
  }

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
