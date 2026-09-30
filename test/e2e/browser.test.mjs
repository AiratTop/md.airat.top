/**
 * Browser regression tests: the page scripts, run in Chrome against `wrangler dev`.
 *
 * The vitest suite runs in workerd and never executes public_html/*.js, so it cannot see
 * a handler bound to the wrong element, a layout that grows with the document, or a
 * storage failure swallowed in silence. Each test here is one of those, found in an
 * audit and fixed; each fails if its fix is reverted.
 *
 * Run: `npm run test:e2e` (applies the local D1 migrations, starts `wrangler dev`, and
 * uses the Chrome installed on the machine — GitHub's Ubuntu runners have one).
 * The pages make no third-party requests, so the suite needs no network, and every test
 * checks that this stays true.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let server;
let browser;

before(async () => {
  server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1"], {
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: "ignore",
    detached: true,
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("wrangler dev did not start");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
});

after(async () => {
  // Clean up before asserting: a failed assertion must not leave wrangler dev running.
  await browser?.close();
  if (server) process.kill(-server.pid);
  assert.deepEqual(foreignRequests, [], "a page requested another origin");
});

/**
 * A fresh page. Any request to another origin, or any resource the CSP refused, fails
 * the suite:
 * the site carries no analytics and no third-party script, and a document in these tests
 * links to other sites but embeds nothing from them.
 */
const foreignRequests = [];

async function openPage(path = "/", { blockStorage = false, draft } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route(/.*/, (route) => {
    const url = route.request().url();
    if (url.startsWith(BASE)) return route.continue();
    foreignRequests.push(url);
    return route.abort();
  });
  if (draft !== undefined) {
    await context.addInitScript((value) => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("md-preview-content", value);
        sessionStorage.setItem("seeded", "1");
      }
    }, draft);
  }
  if (blockStorage) {
    await context.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new DOMException("quota", "QuotaExceededError");
      };
    });
  }
  const page = await context.newPage();
  // A third-party script added to a page is blocked by the CSP before it makes any
  // request, so the violation report is where it shows up.
  page.on("console", (message) => {
    if (/Content Security Policy/.test(message.text())) foreignRequests.push(message.text());
  });
  const posts = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/shares")) posts.push(request);
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto(BASE + path);
  return { page, posts, context };
}

async function share(page) {
  await page.click("#shareBtn");
  await page.waitForSelector("#shareDialog[open]");
  if (await page.isVisible("#shareConfirm")) await page.click("#shareCreate");
  await page.waitForSelector("#shareResult:not([hidden])");
  return page.inputValue("#shareUrl");
}

test("markdown cannot stand in for a dialog control and publish the draft", async () => {
  const { page, posts, context } = await openPage("/", { draft: '<a id="shareCreate" href="#">Read more</a>' });
  const link = page.locator("#preview a");
  assert.equal(await link.getAttribute("id"), "user-content-shareCreate");
  await link.click();
  await page.waitForTimeout(300);
  assert.equal(posts.length, 0, "clicking the document's link sent a share");
  assert.equal(await page.isVisible("#shareDialog"), false);

  // The real control still works.
  await share(page);
  assert.equal(posts.length, 1);
  await context.close();
});

test("a link in the document opens in a new tab and sends nothing anywhere else", async () => {
  const { page, context } = await openPage("/", { draft: "[Private](https://example.com/private?token=SECRET)" });
  const link = page.locator("#preview a");
  assert.equal(await link.getAttribute("target"), "_blank");
  assert.match(await link.getAttribute("rel"), /noreferrer/);
  const before = foreignRequests.length;
  await page.click("#preview", { position: { x: 5, y: 5 } });
  await page.click("#copyBtn");
  assert.equal(foreignRequests.length, before);
  await context.close();
});

test("sharing the same text again offers the same link; changed text gets a new one", async () => {
  const text = `# Dedup ${Date.now()}\n\nbody`;
  const { page, posts, context } = await openPage("/", { draft: text });
  const first = await share(page);
  await page.click("#shareResult [data-close]");

  const second = await share(page);
  assert.equal(second, first);
  assert.equal(posts.length, 1, "a second POST was sent for the same text");
  assert.equal(await page.isVisible("#shareReused"), true);
  await page.click("#shareResult [data-close]");

  await page.fill("#markdownInput", `${text}.`);
  const third = await share(page);
  assert.notEqual(third, first);
  assert.equal(posts.length, 2);
  await context.close();
});

test("a long document scrolls inside the panes, and Sync Scroll follows", async () => {
  const long = Array.from({ length: 300 }, (_, i) => `Paragraph ${i}`).join("\n\n");
  const { page, context } = await openPage("/", { draft: long });
  const metrics = await page.evaluate(() => ({
    pageHeight: document.documentElement.scrollHeight,
    viewport: innerHeight,
    previewScrolls: document.getElementById("preview").scrollHeight > document.getElementById("preview").clientHeight,
  }));
  assert.ok(metrics.pageHeight <= metrics.viewport + 2, `page grew to ${metrics.pageHeight}px`);
  assert.ok(metrics.previewScrolls, "the preview does not scroll inside itself");

  await page.evaluate(() => {
    const area = document.getElementById("markdownInput");
    area.scrollTop = area.scrollHeight;
    area.dispatchEvent(new Event("scroll"));
  });
  await page.waitForTimeout(100);
  assert.ok((await page.evaluate(() => document.getElementById("preview").scrollTop)) > 0, "Sync Scroll did not move the preview");
  await context.close();
});

test("with storage blocked, a new link can still be deleted and the user is told", async () => {
  const { page, context } = await openPage("/", { blockStorage: true });
  await page.fill("#markdownInput", `# Blocked storage ${Date.now()}`);
  assert.match(await page.textContent("#status"), /storage is full or blocked/);

  const url = await share(page);
  assert.equal(await page.isVisible("#shareTokenNote"), true);
  await page.click("#shareDelete");
  await page.waitForSelector("#shareDialog:not([open])", { state: "attached" });
  const id = url.split("/").pop();
  assert.equal((await fetch(`${BASE}/${id}.md`)).status, 404);
  await context.close();
});

test("Open in editor does not leave the page when it cannot hand the text over", async () => {
  const created = await (
    await fetch(`${BASE}/api/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "# Handover" }),
    })
  ).json();
  const { page, context } = await openPage(`/${created.id}`, { blockStorage: true });
  await page.click("#editBtn");
  await page.waitForTimeout(300);
  assert.equal(new URL(page.url()).pathname, `/${created.id}`);
  assert.match(await page.textContent("#status"), /storage is blocked/);
  await context.close();
});

test("Reset asks before replacing a draft", async () => {
  const { page, context } = await openPage("/", { draft: "my only draft" });
  page.removeAllListeners("dialog");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.click("#resetBtn");
  assert.equal(await page.inputValue("#markdownInput"), "my only draft");
  await context.close();
});

test("task lists keep their done and not-done marks", async () => {
  const { page, context } = await openPage("/", { draft: "- [ ] todo\n- [x] done" });
  assert.equal(await page.locator("#preview .task-box").count(), 2);
  assert.equal(await page.locator("#preview .task-box.is-done").count(), 1);
  await context.close();
});

test("an emptied draft stays empty after a reload", async () => {
  const { page, context } = await openPage("/", { draft: "" });
  await page.reload();
  assert.equal(await page.inputValue("#markdownInput"), "");
  await context.close();
});

test("extended markdown renders: front matter, sub/sup, footnotes, emoji, highlighting, marks", async () => {
  const draft = [
    "---",
    "title: Feature tour",
    'tags: ["a", "b"]',
    "---",
    "",
    "19^th^ and H~2~O, ==marked== and ++inserted++.",
    "",
    "Footnote[^one] and inline^[inline note].",
    "",
    "[^one]: The note.",
    "",
    ":wink: and :-)",
    "",
    "*[HTML]: Hyper Text Markup Language",
    "HTML here.",
    "",
    "Term",
    ":   Definition",
    "",
    "```javascript",
    "const x = 1; // note",
    "```",
    "",
    "```not-a-language",
    "plain",
    "```",
  ].join("\n");
  const { page, context } = await openPage("/", { draft });
  const found = await page.evaluate(() => {
    const q = (selector) => document.querySelector(`#preview ${selector}`);
    const ref = q(".footnote-ref a");
    return {
      frontMatter: [...document.querySelectorAll("#preview table.front-matter th")].map((th) => th.textContent).join(","),
      tags: q("table.front-matter td:last-child")?.textContent,
      sup: q("sup:not(.footnote-ref)")?.textContent,
      sub: q("sub")?.textContent,
      mark: q("mark")?.textContent,
      ins: q("ins")?.textContent,
      footnotes: document.querySelectorAll("#preview .footnotes li").length,
      footnoteTargetExists: Boolean(ref && document.getElementById(ref.getAttribute("href").slice(1))),
      footnoteSameTab: ref?.getAttribute("target"),
      emoji: q("p:has(+ p abbr), p")?.textContent,
      abbr: q("abbr")?.getAttribute("title"),
      dt: q("dt")?.textContent,
      highlighted: document.querySelectorAll("#preview code.hljs.language-javascript span").length,
      plainFence: q("pre code:not(.hljs)")?.textContent.trim(),
    };
  });
  assert.equal(found.frontMatter, "title,tags");
  assert.equal(found.tags, "a, b");
  assert.equal(found.sup, "th");
  assert.equal(found.sub, "2");
  assert.equal(found.mark, "marked");
  assert.equal(found.ins, "inserted");
  assert.equal(found.footnotes, 2);
  assert.equal(found.footnoteTargetExists, true, "a footnote link must reach its note after ids are prefixed");
  assert.equal(found.footnoteSameTab, null);
  assert.ok(await page.locator("#preview", { hasText: "😉" }).count());
  assert.equal(found.abbr, "Hyper Text Markup Language");
  assert.equal(found.dt, "Term");
  assert.ok(found.highlighted > 0, "javascript was not highlighted");
  assert.equal(found.plainFence, "plain");
  await context.close();
});

test("mermaid draws a valid diagram, marks an invalid one, and its SVG is sanitised", async () => {
  const draft = [
    "```mermaid",
    "graph TD",
    "  A[Start] --> B[End]",
    "```",
    "",
    "```mermaid",
    "this is not a diagram",
    "```",
  ].join("\n");
  const { page, context } = await openPage("/", { draft });
  await page.waitForSelector("#preview .mermaid-diagram svg", { timeout: 10_000 });
  await page.waitForSelector("#preview pre.mermaid-source.is-invalid", { timeout: 10_000 });
  assert.match(await page.textContent("#preview .mermaid-diagram"), /End/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).display), "block");
  // Labels are SVG text: a <foreignObject> would carry HTML past the SVG sanitiser.
  assert.equal(await page.locator("#preview .mermaid-diagram foreignObject").count(), 0);
  const handlers = await page.evaluate(() =>
    [...document.querySelectorAll("#preview .mermaid-diagram *")].filter((node) =>
      [...node.attributes].some((attribute) => attribute.name.startsWith("on"))
    ).length
  );
  assert.equal(handlers, 0);
  await context.close();
});

test("math renders with KaTeX; prices stay prose and untrusted commands stay out", async () => {
  const draft = [
    "Inline $E = mc^2$, and a price: $5 and $10.",
    "",
    "$$",
    "\\frac{1}{2}",
    "$$",
    "",
    "```math",
    "a^2 + b^2 = c^2",
    "```",
    "",
    "Link attempt $\\href{https://example.com}{x}$.",
  ].join("\n");
  const { page, context } = await openPage("/", { draft });
  await page.waitForSelector("#preview .katex", { timeout: 10_000 });
  const found = await page.evaluate(() => ({
    rendered: document.querySelectorAll("#preview .math-tex.is-rendered").length,
    display: document.querySelectorAll("#preview .katex-display").length,
    prose: document.querySelector("#preview p").textContent,
    links: document.querySelectorAll("#preview .katex a").length,
  }));
  assert.equal(found.rendered, 4);
  assert.equal(found.display, 2);
  assert.match(found.prose, /\$5 and \$10/);
  assert.equal(found.links, 0, "\\href must not produce a link");
  await context.close();
});
