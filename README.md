# Markdown Live Preview

[![md.airat.top](https://raw.githubusercontent.com/AiratTop/md.airat.top/main/public_html/canvas.png)](https://md.airat.top/)

A local, private markdown live preview tool with a split editor and preview. Runs as a pure static site and is deployed as static assets on Cloudflare Workers.

- Live site: https://md.airat.top
- Redirect: https://markdown.airat.top
- Status page: https://status.airat.top

## Features

- Live markdown rendering with GitHub-flavored markdown.
- Split layout: editor on the left, preview on the right.
- Sync scroll, reset, and copy actions.
- Dark mode based on browser settings with manual override.
- No server, no third-party services.

## Local usage

Open `public_html/index.html` in your browser.

## Deployment

Cloudflare Workers Builds deploys the contents of `public_html` as static assets. The project has no build step; deployment uses `npx wrangler deploy` with the settings in `wrangler.jsonc`.

## License

The original source code, configuration, and documentation in this repository are licensed under
the [Apache License 2.0](LICENSE), with copyright details in [NOTICE](NOTICE).

`public_html/vendor/marked.min.js` is third-party software distributed under the MIT License by
its copyright holders. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

## Author

**AiratTop (Airat Halitov)**

- Website: [airat.top](https://airat.top)
- GitHub: [@AiratTop](https://github.com/AiratTop)
- Email: [mail@airat.top](mailto:mail@airat.top)
- Repository: [md.airat.top](https://github.com/AiratTop/md.airat.top)
