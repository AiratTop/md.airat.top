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
  Representation URLs (`.md`, `.json`) follow `../orator-space`.

## Structure
- Worker entry: `src/index.js` — routing, rate limiting, cron sweep.
- `src/address.js` the rate-limit bucket (IPv6 per /64);
  `src/share.js` the three representations of a share and the page title;
  `src/api.js` create/delete; `src/db.js` every D1 statement; `src/http.js` response
  headers and the body reader; `src/limits.js` the numbers; `src/ids.js` ULIDs.
- Schema: `migrations/`, applied with `wrangler d1 migrations apply DB`.
- Static UI in `public_html/`:
  - `index.html` + `app.js` the editor and the share dialog;
  - `view.html` + `view.js` the shared-document page (the Worker fills the shell);
  - `render.js` markdown → sanitised HTML (marked + DOMPurify), used by both pages;
  - `common.js` storage, theme, delete tokens, date formatting, used by both pages;
  - `analytics.js` the GA counter; `vendor/` marked and DOMPurify.
- Tests: `test/`, run with `npm test` — vitest in `workerd` against a real local D1 with
  the real `migrations/` applied.

## URLs
- `/` the editor — the only indexable page.
- `/{ULID}` the shared page; `/{ULID}.md` raw markdown (`text/plain`, so browsers show
  it rather than download it); `/{ULID}.json` markdown plus metadata. Lowercase ids 301
  to uppercase. Unknown, expired and deleted are one 404.
- `POST /api/shares` `{content}` → links, `expiresAt`, `deleteToken` (returned once).
- `DELETE /api/shares/{id}` `{deleteToken}`.
- `/health` liveness with a D1 round trip, ahead of the rate limiter.

## Invariants
- The editor never sends the text anywhere (the GA counter reports page views only).
  Uploading happens only from the share dialog, after the author confirms that anyone
  with the link can read the text.
- Shares are plaintext on purpose (so `.md` works for curl and models); the 80 random
  bits of the ULID are the only access control. Never make ids shorter or sequential.
- Every read of a share filters `expires_at > now`; the hourly cron only reclaims space.
- Markdown that reaches the DOM goes through `renderMarkdown` (DOMPurify). This covers
  the editor too, because "Open in editor" loads someone else's document there.
- No inline script on any page: the CSP in `src/http.js` forbids it. That is why the GA
  snippet lives in `analytics.js`.
- Shared pages must not leak their URL: `Referrer-Policy: no-referrer`, and `analytics.js`
  reports them to GA as `/shared` with a fixed title.
- Everything except `/` and its assets carries `noindex` and `no-store`, and is disallowed
  in `robots.txt`.

## AI Working Notes
- Share lifetime is fixed at 24 hours (`SHARE_TTL_MS`). Content cap 256 KB of UTF-8,
  repeated in `app.js` as `MAX_SHARE_BYTES`; `test/limits.test.ts` keeps them equal.
- Creating is rate limited per IPv4 address or IPv6 /64 (`src/address.js`), 10/minute
  and 200/day, via the Durable Object in `src/rate-limiter.js` (see `../secret.airat.top/AGENTS.md` for why not the rate limit
  binding). Reading is not metered. If D1 ever fills, creates fail until the oldest shares
  expire — reads are unaffected and it heals itself within 24 hours.
- Delete tokens are stored only as SHA-256; the creator's browser keeps the token in
  localStorage (`md-preview-shares`) for "Delete now".
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
- Keep the Google Analytics counter (`analytics.js`) and site-verification tags.
- Preserve editor/preview parity and readability on mobile/desktop.
