# Contributing

Thank you for your interest in improving the Markdown Live Preview app at md.airat.top. Contributions of all kinds are welcome, including bug reports, documentation improvements, and UI or UX polish.

## How to Help

- **Report bugs or suggest enhancements** by opening an issue on GitHub. Please include clear reproduction steps, your browser and OS, and any console errors.
- **Improve documentation** by fixing typos or clarifying usage details in the README.
- **Submit pull requests** for HTML, CSS, or JavaScript improvements, accessibility, or performance tweaks.

## Before You Start

- Read the repository `README.md` to understand the project goals and constraints.
- Keep changes focused. If you have multiple unrelated ideas, open separate pull requests.
- The editor is static and there is no build step at deploy time: client libraries are prebuilt into `public_html/vendor/` by `npm run vendor` and committed. Share links are served by a Cloudflare Worker with a D1 database (`src/`). Keep dependencies minimal and avoid adding external services or trackers.
- Read `AGENTS.md` for the invariants around share links (sanitising, no inline script, no URL leaks).

## Development Workflow

1. Fork the repository and clone your fork locally.
2. Create a feature branch that describes your work (for example, `feature/better-shortcuts`).
3. Make your changes and keep commits scoped and meaningful.
4. Validate the changes locally with `npm install`, `npm run db:migrate:local` and `npm run dev`, and run `npm test`, `npm run test:e2e` (needs Chrome) and `npm run typecheck`. After changing a
   client library version in `package.json`, run `npm run vendor` and commit `public_html/vendor/`
   and `THIRD_PARTY_NOTICES.md` with it.
5. Check both light and dark modes, and verify layout on narrow screens.
6. Open a pull request against the `main` branch and describe what changed and how you verified it.

## Pull Request Checklist

- [ ] `npm test`, `npm run test:e2e` and `npm run typecheck` pass.
- [ ] No console errors in the browser.
- [ ] Changes are tested in at least one modern browser.
- [ ] UI changes behave well on small screens and in dark mode.
- [ ] Documentation updated if user-facing behavior changed.

## Code Style and Standards

- Keep the project lightweight and easy to run locally.
- Use clear, readable vanilla JavaScript and CSS that matches existing style.
- Prefer accessibility-friendly patterns (keyboard use, contrast, focus states).

## Security and Responsible Disclosure

If you discover a security vulnerability, please do not open a public issue. See [SECURITY.md](../SECURITY.md) for what is in scope and how to report it.

## Questions or Feedback

If you are unsure about anything before contributing, feel free to open a discussion or contact AiratTop at [mail@airat.top](mailto:mail@airat.top). Thanks!
