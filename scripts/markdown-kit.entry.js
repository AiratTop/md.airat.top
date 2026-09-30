// Entry point for public_html/vendor/markdown-kit.js: the markdown dialect from
// src/markdown.js with everything it imports, bundled from npm by scripts/vendor.mjs.

import { createMarkdown, escapeHtml } from "../src/markdown.js";

globalThis.MarkdownKit = { md: createMarkdown(), escapeHtml };
