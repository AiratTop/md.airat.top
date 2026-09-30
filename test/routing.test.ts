import { describe, it, expect } from "vitest";
import { BASE, call, post, readJson } from "./helpers.js";
import { newId } from "../src/ids.js";
import { shareTitle } from "../src/share.js";

async function create(content: string) {
  return readJson(await post("/api/shares", { content }));
}

/** The JSON the Worker embedded in the page, parsed the way view.js parses it. */
function embedded(html: string) {
  const match = /<script type="application\/json" id="share-data">([\s\S]*?)<\/script>/.exec(html);
  expect(match).not.toBeNull();
  return JSON.parse(match![1]);
}

describe("the shared page", () => {
  it("embeds the document and titles the page after its first heading", async () => {
    const content = "Intro line\n\n## Release plan: Q4\n\nBody";
    const share = await create(content);
    const response = await call(`/${share.id}`);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("<title>Release plan: Q4 — md.airat.top</title>");
    expect(html).toContain('<meta property="og:title" content="Release plan: Q4"');
    expect(html).toContain(`<meta property="og:url" content="${share.url}"`);
    expect(html).toContain(`href="${share.markdownUrl}"`);
    expect(embedded(html)).toMatchObject({ id: share.id, content, markdownUrl: share.markdownUrl });
  });

  /**
   * The document travels inside a <script> element, and HTML ends that element at the
   * first `</script` whatever the JSON around it says. Unescaped, this content would run.
   */
  it("cannot break out of the element it is embedded in", async () => {
    const content = '</script><script>alert(1)</script><!-- & "quotes"  ';
    const share = await create(content);
    const html = await (await call(`/${share.id}`)).text();

    expect(html).not.toContain("<script>alert(1)");
    expect(embedded(html).content).toBe(content);
  });

  it("escapes the title it writes into the head", async () => {
    const share = await create('# <img src=x onerror=alert(1)> "quoted"');
    const html = await (await call(`/${share.id}`)).text();
    expect(html).not.toContain("onerror=alert(1)>");
  });

  it("answers 404 with the expired state for an unknown id", async () => {
    const response = await call(`/${newId()}`);
    const html = await response.text();
    expect(response.status).toBe(404);
    expect(embedded(html)).toBeNull();
    expect(html).toContain("<title>Link expired — md.airat.top</title>");
    expect(html).not.toContain('id="alternate-md"');
  });

  it("carries a content policy with no inline script", async () => {
    const share = await create("# hi");
    const csp = (await call(`/${share.id}`)).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("script-src 'self';");
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("redirects a lowercase id to the one canonical URL, keeping the format", async () => {
    const id = newId();
    for (const suffix of ["", ".md", ".json"]) {
      const response = await call(`/${id.toLowerCase()}${suffix}`);
      expect(response.status).toBe(301);
      expect(response.headers.get("location")).toBe(`${BASE}/${id}${suffix}`);
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
    }
  });

  it("does not treat other paths as shares", async () => {
    expect((await call("/about")).status).toBe(404);
    expect((await call(`/${newId().slice(1)}`)).status).toBe(404); // one char short
    expect((await call(`/${newId()}.txt`)).status).toBe(404);
    expect((await call(`/8${newId().slice(1)}`)).status).toBe(404); // above the ULID range
  });

  it("does not serve the unfilled shell directly", async () => {
    expect((await call("/view.html")).status).toBe(404);
  });

  it("refuses to be written to", async () => {
    const response = await call(`/${newId()}.md`, { method: "PUT", body: "x" });
    expect(response.status).toBe(405);
  });
});

describe("shareTitle", () => {
  it("uses the first heading, else the first line with text in it", () => {
    expect(shareTitle("# Hello  #")).toBe("Hello");
    expect(shareTitle("text\n### **Bold** [link](https://x.y) `code`")).toBe("Bold link code");
    expect(shareTitle("\n\n---\n> Quoted first line\nmore")).toBe("Quoted first line");
    expect(shareTitle("```\n\n```")).toBe("Shared markdown");
  });

  it("prefers the front-matter title", () => {
    expect(shareTitle('---\ntitle: "Welcome to Markdown Viewer"\nauthor: x\n---\n\n# Heading')).toBe("Welcome to Markdown Viewer");
    expect(shareTitle("---\nauthor: x\n---\n\n# Heading")).toBe("Heading");
    expect(shareTitle("Intro\n---\ntitle: not front matter\n---")).toBe("Intro");
  });

  it("keeps a long title short", () => {
    const title = shareTitle(`# ${"word ".repeat(60)}`);
    expect(title.length).toBeLessThanOrEqual(90);
    expect(title.endsWith("…")).toBe(true);
  });
});

describe("the editor", () => {
  /** The one page meant to be found. Every other response carries noindex. */
  it("is indexable and carries the content policy", async () => {
    const response = await call("/");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self'");
  });

  it("has no inline script, which the content policy would block", async () => {
    for (const page of ["/", "/view.html"]) {
      const path = page === "/" ? "/" : `/${newId()}`;
      const html = await (await call(path)).text();
      const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter(
        ([, attributes]) => !attributes.includes('type="application/json"')
      );
      expect(inline, `${page} has inline script`).toEqual([]);
    }
  });

  /** No analytics: a third-party script would see drafts, shared documents and tokens. */
  it("loads no third-party script", async () => {
    for (const path of ["/", `/${newId()}`]) {
      const html = await (await call(path)).text();
      const scripts = [...html.matchAll(/<script[^>]*src="([^"]*)"/g)].map((m) => m[1]);
      expect(scripts.length).toBeGreaterThan(0);
      for (const src of scripts) expect(src.startsWith("/"), `${path} loads ${src}`).toBe(true);
    }
  });

  it("allows a crawler the assets it needs to render the page", async () => {
    const robots = await (await call("/robots.txt")).text();
    const html = await (await call("/")).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+\.(?:js|css))"/g)].map((m) => m[1]);

    expect(assets.length).toBeGreaterThan(0);
    for (const asset of assets) {
      const allowed = robots.includes(`Allow: ${asset}\n`) || (asset.startsWith("/vendor/") && robots.includes("Allow: /vendor/\n"));
      expect(allowed, `${asset} is blocked`).toBe(true);
    }
    expect(robots).toContain("Disallow: /\n");
  });

  it("finds every element app.js and view.js look up", async () => {
    for (const [script, page] of [["/app.js", "/"], ["/view.js", `/${newId()}`], ["/common.js", "/"]]) {
      const source = await (await call(script)).text();
      const html = await (await call(page)).text();
      for (const [, id] of source.matchAll(/(?:getElementById|inDialog)\("([^"]+)"\)/g)) {
        expect(html, `#${id} used by ${script} is missing from ${page}`).toContain(`id="${id}"`);
      }
    }
  });
});

describe("hostile input", () => {
  /**
   * The heading pattern backtracks quadratically on a long run of spaces. Run over the
   * whole document, 20 KB of them took a second; 256 KB would have taken minutes of CPU
   * on every view of the share.
   */
  it("finds a title in linear time", () => {
    const spaces = " ".repeat(256 * 1024);
    for (const content of [`# a${spaces}b`, `# a${" \t".repeat(128 * 1024)}b`, `x\n${"[a](".repeat(64 * 1024)}`]) {
      const started = performance.now();
      shareTitle(content);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });

  it("still finds a heading after a very long line", () => {
    expect(shareTitle(`${"x".repeat(100_000)}\n## Later heading`)).toBe("Later heading");
  });

  it("escapes a title written into an attribute", async () => {
    const share = await create('# a" autofocus onfocus="alert(1)');
    const html = await (await call(`/${share.id}`)).text();
    expect(html).not.toContain('content="a" autofocus');
    expect(html).toMatch(/<meta property="og:title" content="a&quot; autofocus onfocus=&quot;alert\(1\)"/);
  });
});
