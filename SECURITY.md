# Security Policy

## Reporting a vulnerability

Email [mail@airat.top](mailto:mail@airat.top) with the details and, if you can, a way
to reproduce it. Please do not open a public issue for a vulnerability. You should get a
reply within a few days.

To report abusive content on a shared link rather than a flaw in the service, use the
**Report abuse** link on that page.

## What is in scope

- `https://md.airat.top`: the editor, the shared pages (`/{id}`, `/{id}.md`,
  `/{id}.json`, `/{id}.html`) and the API (`/api/shares`).
- The code in this repository.

Especially interesting:

- script execution through shared markdown (on the shared page or in the editor after
  **Open in editor**);
- reading or deleting a share without its link or its delete token;
- a share that stays readable after it expired or was deleted;
- ways around the rate limits or the size cap;
- a request that costs the Worker disproportionate CPU or storage.

## Out of scope

- The content of shared documents. Shares are plaintext by design and readable by
  anyone with the link. Do not use them for secrets; use
  [secret.airat.top](https://secret.airat.top).
- Images in a shared document load from their own hosts, which see the reader's IP
  address. This is how markdown images work.
- Reports from automated scanners without a demonstrated impact.

## Design notes

- Rendered markdown is sanitised with DOMPurify in the browser, under a content security
  policy that allows no inline script. `/{id}.html`, rendered on the server, is cleaned
  with an HTMLRewriter allowlist instead and served with `script-src 'none'`.
- Math (KaTeX) and diagrams (mermaid) are rendered after sanitising, from text the
  sanitiser has already seen, with KaTeX's `trust` off and mermaid in strict mode.
- Ids are ULIDs with 80 random bits; the link is the only access control.
- Delete tokens are stored only as SHA-256 hashes.
- Every read checks expiry; an hourly job deletes expired rows.
