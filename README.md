# Markdown Live Preview

[![md.airat.top](https://raw.githubusercontent.com/AiratTop/md.airat.top/main/public_html/canvas.png)](https://md.airat.top/)

A private markdown live preview with a split editor and preview: GitHub-flavored markdown
with code highlighting, KaTeX math and Mermaid diagrams, export to HTML and PDF, and
temporary share links that delete themselves after 24 hours. Runs on Cloudflare Workers
with a D1 database.

- Live site: https://md.airat.top
- Redirect: https://markdown.airat.top
- Status page: https://status.airat.top

## Features

- Live markdown rendering with GitHub-flavored markdown (tables, task lists,
  strikethrough, autolinks) and more:
  - syntax highlighting for fenced code with a language, about 50 of them:
    highlight.js's common set (JavaScript/TypeScript, Python, Bash, SQL, JSON, YAML,
    Go, Rust, Java, C/C++/C#, PHP, Ruby, Kotlin, Swift and more) plus Dockerfile,
    nginx, Apache, PowerShell, batch, CMake, HTTP, Protobuf, Dart, Scala, Groovy,
    Elixir, Haskell, LaTeX and MATLAB;
  - [Mermaid](https://mermaid.js.org) diagrams in ` ```mermaid ` blocks;
  - math with [KaTeX](https://katex.org): `$inline$`, `$$display$$` and ` ```math `
    blocks (a dollar next to a digit or a space stays a dollar, so prices are safe);
  - footnotes, subscript (`H~2~O`) and superscript (`19^th^`), `==highlight==`,
    `++inserted++` text, abbreviations, definition lists and `:emoji:` shortcodes;
  - YAML front matter, shown as a table;
  - GitHub alerts: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.
- A first visit (and **Reset**) opens a tour of all of it, kept in `public_html/sample.md`.
- Split layout: editor on the left, preview on the right.
- Sync scroll, reset, and copy actions.
- **Export** to Markdown, a standalone HTML file (styles, fonts and this site's images
  embedded; no scripts) or PDF through the browser's print dialog. Images from other
  sites stay links in the HTML file, so it needs the network to show them. Exports are
  always light and are made in the browser; nothing is uploaded.
- Dark mode based on browser settings with manual override.
- The editor runs in your browser. Your text never leaves it unless you press **Share**.
  One exception, as on any web page: an image from another site
  (`![](https://example.com/a.png)`) loads from that site as soon as you type it, so that
  site sees the image's address and your IP address.
- **Share** creates a temporary link to a snapshot of your text:
  - `https://md.airat.top/{id}`: the rendered document;
  - `https://md.airat.top/{id}.md`: the raw markdown, for curl, scripts and LLMs;
  - `https://md.airat.top/{id}.json`: the markdown plus its metadata;
  - `https://md.airat.top/{id}.html`: the document rendered on the server as plain HTML
    (math included; diagrams stay as their source, since drawing them needs a browser).

  Anyone with the link can read it. It is deleted automatically after 24 hours, and the
  author can delete it earlier. Sharing the same text again from the same browser offers
  the existing link; change a single character and you get a new one.

## Share links

Shares are stored as plaintext so that `.md` can serve the raw text. The link is the only
access control: ids are [ULIDs](https://github.com/ulid/spec) with 80 random bits. Do not
share anything secret this way. For secrets, use [secret.airat.top](https://secret.airat.top).

Shared pages are not indexed and send no referrer. The site carries no analytics and no
third-party scripts. Rendered markdown is sanitised with DOMPurify under a strict content
security policy. Images in a shared document load from wherever the author linked them,
so their hosts see the reader's IP address, as with any markdown viewer.

To report a shared link that carries abuse, use the **Report abuse** link on its page or
write to [mail@airat.top](mailto:mail@airat.top). Security issues: see [SECURITY.md](SECURITY.md).

### API

```bash
# Create a share (limit: 256 KB of UTF-8; 30 per minute and 300 per day per IPv4 address or IPv6 /64)
curl -s https://md.airat.top/api/shares \
  -H 'Content-Type: application/json' \
  -d '{"content":"# Hello\n\nShared from the command line."}'
```

```json
{
  "id": "01M3QS5R0MCCT5HB5SP8N6YM61",
  "url": "https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61",
  "markdownUrl": "https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61.md",
  "jsonUrl": "https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61.json",
  "htmlUrl": "https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61.html",
  "sizeBytes": 38,
  "createdAt": "2026-09-29T23:49:35.380Z",
  "expiresAt": "2026-09-30T23:49:35.380Z",
  "deleteToken": "GYlwIDTPZOSU7I8vHe_fhw80spexZmTX"
}
```

```bash
# Read it back, raw or rendered
curl -s https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61.md
curl -s https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61.html

# Delete it early
curl -s -X DELETE https://md.airat.top/api/shares/01M3QS5R0MCCT5HB5SP8N6YM61 \
  -H 'Content-Type: application/json' \
  -d '{"deleteToken":"GYlwIDTPZOSU7I8vHe_fhw80spexZmTX"}'
```

## Development

```bash
npm install
npm run db:migrate:local
npm run dev          # http://localhost:8787
npm test             # vitest in workerd against a local D1
npm run test:e2e     # the page scripts in Chrome against wrangler dev
npm run typecheck
```

## Deployment

A push to `main` runs `.github/workflows/deploy.yml`, which runs both test suites and the
typecheck, applies D1 migrations and deploys with `wrangler deploy`. It needs the repository secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit) and `CLOUDFLARE_ACCOUNT_ID`.

First-time setup: `npm run db:create`, then put the printed `database_id` into
`wrangler.jsonc`.

## License

The original source code, configuration, and documentation in this repository are licensed under
the [Apache License 2.0](LICENSE), with copyright details in [NOTICE](NOTICE).

Everything in `public_html/vendor/` is third-party software (markdown-it and its plugins,
highlight.js, js-yaml, KaTeX, mermaid, DOMPurify), built from npm by `npm run vendor`,
distributed under their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Author

**AiratTop (Airat Halitov)**

- Website: [airat.top](https://airat.top)
- GitHub: [@AiratTop](https://github.com/AiratTop)
- Email: [mail@airat.top](mailto:mail@airat.top)
- Repository: [md.airat.top](https://github.com/AiratTop/md.airat.top)
