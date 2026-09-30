# AGENTS.md

## Purpose
Browser Markdown live preview tool (`md.airat.top`), plus temporary share links: a
snapshot of the text, readable by anyone with the link, deleted automatically after
24 hours.

Why sharing exists: passing a markdown document to someone (or to a model) should take
one click and no account, and nothing needs to be kept for long. It is not a pastebin
and not a secret store — see `../secret.airat.top` for that.

## Repository Role
- Category: `*.airat.top` (public tool/service).
- Deployment platform: Cloudflare Workers with static assets and a D1 database.
- Deployment configuration: `wrangler.jsonc`.
- Deployment trigger: GitHub Actions (`.github/workflows/deploy.yml`) on push to `main`,
  not the Cloudflare Git integration — Workers Builds does not apply D1 migrations. It
  runs tests and typecheck, applies migrations, then deploys. Secrets:
  `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit) and `CLOUDFLARE_ACCOUNT_ID`.
  `.github/workflows/ci.yml` runs the same checks on pull requests with no credentials.
- Custom domain: attached in the Cloudflare dashboard, not declared in `wrangler.jsonc`.
- Architecture sibling: `../secret.airat.top` (same Worker/D1/rate-limiter/test layout).
  Representation URLs (`.md`, `.json`, `.html`) follow `../orator-space`.

## Structure
- Worker entry: `src/index.js` — routing, rate limiting, cron sweep.
- `src/address.js` the rate-limit bucket (IPv6 per /64);
  `src/share.js` the page and the `.md`/`.json`/`.html` representations, and the title;
  `src/markdown.js` the markdown dialect, shared with the browser bundle;
  `src/html.js` the server-side rendering and cleaning behind `/{id}.html`;
  `src/api.js` create/delete; `src/db.js` every D1 statement; `src/http.js` response
  headers and the body reader; `src/limits.js` the numbers; `src/ids.js` ULIDs.
- Schema: `migrations/`, applied with `wrangler d1 migrations apply DB`.
- Static UI in `public_html/`:
  - `index.html` + `app.js` the editor and the share dialog;
  - `view.html` + `view.js` the shared-document page (the Worker fills the shell);
  - `render.js` markdown → sanitised HTML in the browser, used by both pages: the
    dialect from `src/markdown.js` (via `vendor/markdown-kit.js`), DOMPurify, and
    `renderDiagrams()` for mermaid, `renderMath()` for KaTeX;
  - `common.js` storage, theme, delete tokens, date formatting, used by both pages;
  - `export.js` the Export menu on both pages: Markdown, standalone HTML, PDF (print);
  - `sample.md` the tour shown on a first visit and by Reset;
  - `vendor/` built by `npm run vendor` (`scripts/vendor.mjs`) from pinned
    devDependencies — never edited by hand: `markdown-kit.js` (`src/markdown.js` with
    everything it imports; entry `scripts/markdown-kit.entry.js`), `mermaid/` (ESM, one chunk per diagram type,
    loaded only when a document has a diagram), `katex/` (ESM, CSS, woff2 fonts; loaded
    only when a document has math), `purify.min.js`, `highlight.css`.
    It also regenerates `THIRD_PARTY_NOTICES.md`; CI fails if either is out of date.
- Tests: `test/`, run with `npm test` — vitest in `workerd` against a real local D1 with
  the real `migrations/` applied. `test/e2e/` runs the page scripts in Chrome against
  `wrangler dev` (`npm run test:e2e`); both run in CI and before deploy.

## URLs
- `/` the editor — the only indexable page.
- `/{ULID}` the shared page; `/{ULID}.md` raw markdown (`text/plain`, so browsers show
  it rather than download it); `/{ULID}.json` markdown plus metadata; `/{ULID}.html`
  rendered on the server (`src/html.js`). Lowercase ids 301
  to uppercase. Unknown, expired and deleted are one 404.
- `POST /api/shares` `{content}` → links, `expiresAt`, `deleteToken` (returned once).
- `DELETE /api/shares/{id}` `{deleteToken}`.
- `/health` liveness with a D1 round trip, ahead of the rate limiter.

## Invariants
- The editor never sends the text anywhere. Uploading happens only from the share dialog, after the author confirms that anyone
  with the link can read the text.
- Shares are plaintext on purpose (so `.md` works for curl and models); the 80 random
  bits of the ULID are the only access control. Never make ids shorter or sequential.
- Every read of a share filters `expires_at > now`; the hourly cron only reclaims space.
- Markdown that reaches the DOM goes through `renderMarkdown` (DOMPurify). This covers
  the editor too, because "Open in editor" loads someone else's document there.
- Mermaid runs with `securityLevel: "strict"`, SVG-text labels (no `foreignObject`), and
  `secure` keys a diagram's `%%{init}%%` cannot override (`themeCSS`, `htmlLabels` among
  them); its SVG is sanitised again with DOMPurify's SVG profile before insertion.
- Math never renders into the HTML that gets sanitised: KaTeX needs inline styles,
  which the sanitiser strips. `markdown-it-dollarmath` only parses; its renderer writes
  the TeX as text into a `.math-tex` placeholder, and `renderMath()` runs KaTeX into the
  placeholders after sanitising, with `trust: false` and bounded `maxSize`/`maxExpand`.
  The plugin targets markdown-it 13: `overrides` accepts 15 for it, and
  `scripts/markdown-it-utils.shim.js` supplies the one internal file it imports.
- Mermaid is built from its ESM sources, not copied from its dist, so its dependencies
  take the versions and `overrides` pinned here (its dist bundled a vulnerable lodash-es).
- Rendered markdown can carry any id. `SANITIZE_NAMED_PROPS` prefixes them with
  `user-content-`, and page scripts look their controls up before rendering, dialog
  controls inside the dialog. A document once published the draft through
  `<a id="shareCreate">`; `test/e2e` guards it.
- No analytics and no third-party script, on any page. It was removed on 2026-09-30:
  gtag.js has the whole page — drafts, shared documents, delete tokens — and its
  enhanced measurement was caught reporting clicked links from drafts, tokens included.
  The CSP in `src/http.js` allows scripts and requests to this origin only, and
  `test/e2e` fails on any request to another origin. Traffic numbers come from Cloudflare.
- No inline script on any page: the CSP forbids it.
- Shared pages must not leak their URL: `Referrer-Policy: no-referrer`.
- Everything except `/` and its assets carries `noindex` and `no-store`, and is disallowed
  in `robots.txt`.
- Export happens in the browser only. It renders a light copy into `#exportArea`
  (outside the page chrome; `.export-document` carries the light palette, so it stays
  light on a dark page, diagrams included via `renderDiagrams(…, { theme: "default" })`).
  The HTML file is that copy plus this site's CSS, KaTeX fonts and same-origin images
  inlined, with no script. PDF is `window.print()` with `body.is-printing`, which shows
  only `#exportArea`. No settings dialog and no PNG, on purpose: the tool stays simple.

## AI Working Notes
- The markdown dialect lives in `src/markdown.js`, shared by the browser (bundled into
  `vendor/markdown-kit.js` — run `npm run vendor` after changing it; CI checks) and the
  Worker's `/{id}.html`. That route has no DOMPurify (no DOM in a Worker): `src/html.js`
  cleans with an HTMLRewriter allowlist of tags and attributes (URL attributes decoded
  and scheme-checked; any `&` left in a scheme is refused), then renders math into the
  placeholders after cleaning, and serves under `script-src 'none'`. Diagrams stay as
  source. The rendering is cached per share (Cache API) behind the D1 lookup, so a
  deleted share is a 404 whatever the cache holds. `markdown-it-dollarmath`'s internal
  import is aliased to the shim in `wrangler.jsonc`, `vitest.config.ts` and `vendor.mjs`.
- Export file names are `<title>_<YYYY-MM-DD>_<HH-MM-SS>.<ext>` in local time: letters,
  digits, `-` and `_` only, and two exports never overwrite each other.
- Share lifetime is fixed at 24 hours (`SHARE_TTL_MS`). Content cap 256 KB of UTF-8,
  repeated in `app.js` as `MAX_SHARE_BYTES`; `test/limits.test.ts` keeps them equal.
- Creating is rate limited per IPv4 address or IPv6 /64 (`src/address.js`), 10/minute
  and 200/day, via the Durable Object in `src/rate-limiter.js` (see `../secret.airat.top/AGENTS.md` for why not the rate limit
  binding). Reading is not metered. If D1 ever fills, creates fail until the oldest shares
  expire — reads are unaffected and it heals itself within 24 hours.
- Delete tokens are stored only as SHA-256; the creator's browser keeps the token in
  localStorage (`md-preview-shares`) for "Delete now", with a SHA-256 of the text so that
  sharing the same text again offers the existing link (checked with a HEAD to `.md`).
  Deduplication is per browser on purpose: a server-side content lookup would tell
  anyone whether a given text had been shared.
- Storage can fail (quota, private mode). `setStored` returns whether it worked; the
  editor warns once when the draft cannot be saved, the dialog deletes with the token it
  holds in memory, and "Open in editor" stays put rather than open an empty editor.
- `shareTitle` runs server-side on every view of up to 256 KB of someone else's text:
  it scans line by line and cuts each line short before any pattern sees it, because the
  heading pattern backtracks quadratically on long runs of spaces. Keep new title or
  preview logic linear, and test it on a hostile 256 KB input.
- `vitest-pool-workers` pins its own `wrangler`/`miniflare`; `overrides` in `package.json`
  lifts their `undici` and `sharp` past known advisories. Drop an override once the pool
  ships versions that no longer need it.
- The view page's data travels in `<script type="application/json" id="share-data">`;
  `embeddable()` in `src/share.js` escapes `<`, `>` and `&` so a document cannot close it.
- `npm run typecheck` regenerates `worker-configuration.d.ts` (not committed) and runs
  `tsc`. `public_html/*.js` is outside the program; `test/routing.test.ts` checks the
  element ids those scripts look up.

## Site Conventions
- Keep UI style consistent with other AiratTop tools.
- Keep SEO metadata and social tags in `index.html`.
- Keep the site-verification tags. No analytics or other third-party tracking scripts.
- Preserve editor/preview parity and readability on mobile/desktop.
