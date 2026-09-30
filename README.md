# Markdown Live Preview

[![md.airat.top](https://raw.githubusercontent.com/AiratTop/md.airat.top/main/public_html/canvas.png)](https://md.airat.top/)

A private markdown live preview with a split editor and preview, plus temporary share
links that delete themselves after 24 hours. Runs on Cloudflare Workers with a D1 database.

- Live site: https://md.airat.top
- Redirect: https://markdown.airat.top
- Status page: https://status.airat.top

## Features

- Live markdown rendering with GitHub-flavored markdown.
- Split layout: editor on the left, preview on the right.
- Sync scroll, reset, and copy actions.
- Dark mode based on browser settings with manual override.
- The editor runs entirely in your browser and sends nothing anywhere.
- **Share** creates a temporary link to a snapshot of your text:
  - `https://md.airat.top/{id}`: the rendered document;
  - `https://md.airat.top/{id}.md`: the raw markdown, for curl, scripts and LLMs;
  - `https://md.airat.top/{id}.json`: the markdown plus its metadata.

  Anyone with the link can read it. It is deleted automatically after 24 hours, and the
  author can delete it earlier.

## Share links

Shares are stored as plaintext so that `.md` can serve the raw text. The link is the only
access control: ids are [ULIDs](https://github.com/ulid/spec) with 80 random bits. Do not
share anything secret this way. For secrets, use [secret.airat.top](https://secret.airat.top).

Shared pages are not indexed. They send no referrer, and they are reported to analytics
without their URL. Rendered markdown is sanitised with DOMPurify under a strict content
security policy.

### API

```bash
# Create a share (limit: 256 KB of UTF-8; 10 per minute and 200 per day per address)
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
  "sizeBytes": 38,
  "createdAt": "2026-09-29T23:49:35.380Z",
  "expiresAt": "2026-09-30T23:49:35.380Z",
  "deleteToken": "GYlwIDTPZOSU7I8vHe_fhw80spexZmTX"
}
```

```bash
# Read it back
curl -s https://md.airat.top/01M3QS5R0MCCT5HB5SP8N6YM61.md

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
npm run typecheck
```

## Deployment

A push to `main` runs `.github/workflows/deploy.yml`, which tests, typechecks, applies D1
migrations and deploys with `wrangler deploy`. It needs the repository secrets
`CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit) and `CLOUDFLARE_ACCOUNT_ID`.

First-time setup: `npm run db:create`, then put the printed `database_id` into
`wrangler.jsonc`.

## License

The original source code, configuration, and documentation in this repository are licensed under
the [Apache License 2.0](LICENSE), with copyright details in [NOTICE](NOTICE).

`public_html/vendor/marked.min.js` and `public_html/vendor/purify.min.js` are third-party software
distributed under their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Author

**AiratTop (Airat Halitov)**

- Website: [airat.top](https://airat.top)
- GitHub: [@AiratTop](https://github.com/AiratTop)
- Email: [mail@airat.top](mailto:mail@airat.top)
- Repository: [md.airat.top](https://github.com/AiratTop/md.airat.top)
