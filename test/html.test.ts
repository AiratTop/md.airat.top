import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { BASE, call, post, readJson } from "./helpers.js";
import { newId } from "../src/ids.js";
import { renderHtmlFragment } from "../src/html.js";

async function create(content: string) {
  return readJson(await post("/api/shares", { content }));
}

async function fragment(markdown: string) {
  return (await renderHtmlFragment(markdown)).html;
}

describe("/{id}.html", () => {
  it("serves the document as a light, script-free HTML page", async () => {
    const content = "---\ntitle: Report\n---\n\n# Heading\n\n```js\nconst x = 1;\n```\n\nFootnote[^a].\n\n[^a]: Note.\n";
    const share = await create(content);
    expect(share.htmlUrl).toBe(`${BASE}/${share.id}.html`);

    const response = await call(`/${share.id}.html`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'none'");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(html).toContain('<html lang="en" data-theme="light">');
    expect(html).toContain("<title>Report</title>");
    expect(html).toContain('<table class="front-matter">');
    expect(html).toContain("<h1>Heading</h1>");
    expect(html).toContain('class="hljs language-js"');
    expect(html).toContain('class="footnotes"');
    expect(html).not.toContain("<script");
  });

  it("answers 404 for an unknown, and a lowercase id redirects keeping .html", async () => {
    const id = newId();
    expect((await call(`/${id}.html`)).status).toBe(404);
    const redirect = await call(`/${id.toLowerCase()}.html`);
    expect(redirect.status).toBe(301);
    expect(redirect.headers.get("location")).toBe(`${BASE}/${id}.html`);
  });

  /** The rendering is cached; the D1 lookup in front of it is what makes deletion stick. */
  it("stops serving a share once it is deleted, cached rendering or not", async () => {
    const share = await create("# Cached");
    expect((await call(`/${share.id}.html`)).status).toBe(200);
    expect((await call(`/${share.id}.html`)).status).toBe(200);
    await call(`/api/shares/${share.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteToken: share.deleteToken })
    });
    expect((await call(`/${share.id}.html`)).status).toBe(404);
  });

  it("does not serve an expired share either", async () => {
    const share = await create("# Old");
    await env.DB.prepare("UPDATE shares SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, share.id).run();
    expect((await call(`/${share.id}.html`)).status).toBe(404);
  });
});

describe("server-side cleaning", () => {
  it("removes scripts, handlers, styles and everything that runs or loads", async () => {
    const html = await fragment(
      [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(1)">',
        '<p style="position:fixed">styled</p>',
        "<style>body{display:none}</style>",
        '<meta http-equiv="refresh" content="0;url=https://example.com">',
        '<iframe src="https://example.com"></iframe>',
        '<form action="https://example.com"><input name="q"></form>',
        '<base href="https://example.com/">',
        '<svg onload="alert(1)"><circle r="1"/></svg>',
        "<!-- comment -->",
        "<custom-tag>kept text</custom-tag>"
      ].join("\n")
    );
    for (const forbidden of ["<script", "onerror", "style=", "<style", "<meta", "<iframe", "<form", "<input", "<base", "<svg", "alert(1)", "<!--"]) {
      expect(html, forbidden).not.toContain(forbidden);
    }
    expect(html).toContain("styled");
    expect(html).toContain("kept text");
    expect(html).not.toContain("<custom-tag");
  });

  it("refuses dangerous URLs however they are spelled", async () => {
    const html = await fragment(
      [
        '<a href="javascript:alert(1)">a</a>',
        '<a href="&#106;avascript:alert(1)">b</a>',
        '<a href="&#x6A;avascript&#x3A;alert(1)">c</a>',
        '<a href="java&Tab;script:alert(1)">d</a>',
        '<a href="data:text/html,x">e</a>',
        '<img src="data:image/svg+xml,x">'
      ].join("\n")
    );
    expect(html).not.toContain("href=");
    expect(html).not.toContain("src=");
  });

  it("keeps ordinary links and images, and marks outbound links", async () => {
    const html = await fragment(
      '[site](https://example.com/?a=1&b=2) [top](#top) <img src="https://example.com/i.png" alt="i"> <img src="data:image/png;base64,iVBOR" alt="d">'
    );
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
    expect(html).toContain('rel="noopener noreferrer nofollow ugc"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('src="https://example.com/i.png"');
    expect(html).toContain('src="data:image/png;base64,iVBOR"');
  });

  it("renders math with KaTeX after cleaning, and trusts none of it", async () => {
    const { html, hasMath } = await renderHtmlFragment("Inline $x^2$ and a price: $5 and $10.\n\n$$\\frac{1}{2}$$\n\n$\\href{https://example.com}{x}$");
    expect(hasMath).toBe(true);
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("style="); // KaTeX's own positioning survives
    expect(html).toContain("$5 and $10");
    expect(html).not.toContain('href="https://example.com"');
  });

  it("leaves diagrams as their source", async () => {
    const html = await fragment("```mermaid\ngraph LR\n  A --> B\n```");
    expect(html).toContain('<pre class="mermaid-source"><code>graph LR');
  });

  it("turns table alignment into align, the one form the cleaning keeps", async () => {
    const html = await fragment("| Left | Center | Right |\n| :--- | :---: | ---: |\n| x | y | z |");
    expect(html).toContain('<th align="left">Left</th>');
    expect(html).toContain('<th align="center">Center</th>');
    expect(html).toContain('<td align="right">z</td>');
    expect(html).not.toContain("style=");
  });
});

describe("hostile input", () => {
  /** Each of these once made /{id}.html answer 500 for a share that was created fine. */
  const HOSTILE = {
    "a YAML alias that contains itself": "---\na: &a [*a]\n---\n\nhello",
    "a YAML mapping that contains itself": "---\na: &a {b: *a}\n---\n\nhello",
    "a hex character reference past U+10FFFF": '<a href="&#x110000;">text</a>',
    "a decimal character reference past U+10FFFF": '<a href="&#99999999999;">text</a> <img src="&#1114112;x.png">'
  };

  for (const [name, content] of Object.entries(HOSTILE)) {
    it(`serves a share with ${name}`, async () => {
      const share = await create(content);
      const response = await call(`/${share.id}.html`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain(content.includes("hello") ? "hello" : "text");
    });
  }

  it("shows front matter that refers to itself as the YAML it is", async () => {
    for (const yaml of ["a: &a [*a]", "a: &a {b: *a}"]) {
      const html = await fragment(`---\n${yaml}\n---\n\nhello`);
      expect(html).toContain('<pre class="front-matter">');
      expect(html).not.toContain("<table");
    }
  });

  it("does not let YAML aliases multiply a few lines into megabytes", async () => {
    const yaml = [
      'a: &a ["xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx", "xxxxxxxxxx"]',
      "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
      "c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
      "d: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]",
      "e: &e [*d, *d, *d, *d, *d, *d, *d, *d, *d, *d]",
      "f: [*e, *e, *e, *e, *e, *e, *e, *e, *e, *e]"
    ].join("\n");
    const html = await fragment(`---\n${yaml}\n---\n\nhello`);
    expect(html).toContain('<pre class="front-matter">');
    expect(html.length).toBeLessThan(10 * yaml.length);
  });

  it("still shows shared, finite aliases in the table", async () => {
    const html = await fragment("---\nbase: &base {x: 1}\nfirst: *base\nsecond: [*base, *base]\n---\n");
    expect(html).toContain("<td>{&#34;x&#34;:1}</td>");
    expect(html).toContain("<td>{&#34;x&#34;:1}, {&#34;x&#34;:1}</td>");
  });
});
