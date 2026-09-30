// markdown-it-dollarmath (written for markdown-it 13) imports escapeHtml from a file
// markdown-it 15 no longer ships. This hands it markdown-it's own implementation, which
// 15 exposes only as `md.utils`. Wired in by scripts/vendor.mjs; drop it once the plugin
// supports markdown-it 15.
import MarkdownIt from "markdown-it";

export const { escapeHtml } = new MarkdownIt().utils;
