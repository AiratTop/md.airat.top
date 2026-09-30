// Entry point for public_html/vendor/markdown-kit.js — the libraries only, bundled from
// npm by scripts/vendor.mjs. How they are configured lives in public_html/render.js,
// where it can be read and reviewed without digging through a bundle.

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

globalThis.MarkdownKit = {
  MarkdownIt,
  plugins: { sub, sup, footnote, emoji, frontMatter, mark, ins, abbr, deflist, math, alerts },
  hljs,
  loadYaml,
};
