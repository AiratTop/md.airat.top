# AGENTS.md

## Purpose
Public browser Markdown live preview tool (`md.airat.top`).

## Repository Role
- Category: `*.airat.top` (public static tool).
- Deployment platform: Cloudflare Workers (static assets).
- Deployment configuration: `wrangler.jsonc`.
- Main content directory: `public_html`.

## Content and Structure
- Main page: `public_html/index.html`.
- Styling: `public_html/styles.css`.
- Logic: `public_html/app.js`.

## Site Conventions
- Keep UI style consistent with other AiratTop tools.
- Keep SEO metadata and social tags in `index.html`.
- Keep the Google Analytics counter and other required site-verification tags.
- Publish static assets from `public_html`.

## AI Working Notes
- Keep client-side rendering and no-backend architecture.
- Preserve editor/preview parity and readability on mobile/desktop.
