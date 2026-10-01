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

async function openPage(path = "/", { blockStorage = false, draft, scale = 1, beforeGoto, waitUntil = "load" } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: scale });
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
  await beforeGoto?.(page);
  // A test that holds back a stylesheet or an image would never see "load".
  await page.goto(BASE + path, { waitUntil });
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

test("a first visit opens the tour from sample.md, and Reset brings it back", async () => {
  const { page, context } = await openPage("/");
  await page.waitForFunction(() => document.getElementById("markdownInput").value.startsWith("---"));
  assert.equal(await page.locator("#preview table.front-matter").count(), 1);
  assert.equal(await page.locator("#preview .markdown-alert-note").count(), 1);
  const tour = await page.inputValue("#markdownInput");

  await page.fill("#markdownInput", "my own text");
  await page.click("#resetBtn"); // the confirm is accepted by openPage
  await page.waitForFunction((text) => document.getElementById("markdownInput").value === text, tour);
  await context.close();
});

test("text typed before the tour arrives is not replaced by it", async () => {
  let releaseSample;
  const sampleHeld = new Promise((resolve) => (releaseSample = resolve));
  const { page, context } = await openPage("/", {
    beforeGoto: (page) =>
      page.route("**/sample.md", async (route) => {
        await sampleHeld;
        await route.continue();
      }),
  });
  await page.fill("#markdownInput", "typed while the tour was loading");
  releaseSample();
  await page.waitForResponse("**/sample.md");
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue("#markdownInput"), "typed while the tour was loading");
  assert.equal(await page.evaluate(() => localStorage.getItem("md-preview-content")), "typed while the tour was loading");
  await context.close();
});

test("front matter that refers to itself renders as YAML, and the draft is saved", async () => {
  const { page, context } = await openPage("/", { draft: "" });
  const text = "---\na: &a [*a]\nb: &b {c: *b}\n---\n\nhello";
  await page.fill("#markdownInput", text);
  assert.equal(await page.locator("#preview pre.front-matter").count(), 1);
  assert.match(await page.textContent("#preview"), /hello/);
  assert.equal(await page.evaluate(() => localStorage.getItem("md-preview-content")), text);
  await context.close();
});

test("the sanitiser allows HTML only in markdown, and SVG only in diagrams", async () => {
  const draft = [
    '<svg><a href="https://example.com/"><text>svg link</text></a></svg>',
    "",
    "<math><mi>x</mi></math>",
    "",
    "```mermaid",
    "graph TD",
    "  A[Start] --> B[End]",
    "```",
  ].join("\n");
  const { page, context } = await openPage("/", { draft });
  await page.waitForSelector("#preview .mermaid-diagram svg", { timeout: 10_000 });
  const found = await page.evaluate(() => ({
    foreign: document.querySelectorAll("#preview > svg, #preview :not(.mermaid-diagram) > svg, #preview math").length,
    notSvg: [...document.querySelectorAll("#preview .mermaid-diagram svg, #preview .mermaid-diagram svg *")].filter(
      (node) => node.namespaceURI !== "http://www.w3.org/2000/svg"
    ).length,
  }));
  assert.equal(found.foreign, 0, "<svg> or <math> from the markdown survived");
  assert.equal(found.notSvg, 0, "a diagram carried a non-SVG element");
  await context.close();
});

test("an alert title shows its icon, in the alert colour, beside the text", async () => {
  const { page, context } = await openPage("/", { draft: "> [!NOTE]\n> Read this." });
  const found = await page.evaluate(() => {
    const title = document.querySelector("#preview .markdown-alert-title");
    const icon = getComputedStyle(title, "::before");
    return {
      svg: title.querySelectorAll("svg").length,
      mask: icon.maskImage || icon.webkitMaskImage,
      width: icon.width,
      sameColour: icon.backgroundColor === getComputedStyle(title).color,
      gap: getComputedStyle(title).columnGap,
    };
  });
  assert.equal(found.svg, 0);
  assert.match(found.mask, /^url\("data:image\/svg\+xml/);
  assert.equal(found.width, "16px");
  assert.equal(found.sameColour, true);
  assert.equal(found.gap, "8px");
  await context.close();
});

test("table columns keep their alignment", async () => {
  const { page, context } = await openPage("/", { draft: "| L | C | R |\n| :- | :-: | -: |\n| x | y | z |" });
  const aligned = await page.evaluate(() =>
    [...document.querySelectorAll("#preview td")].map((cell) => getComputedStyle(cell).textAlign)
  );
  assert.deepEqual(aligned, ["left", "center", "right"]);
  await context.close();
});

test("the panel divider moves with the keyboard", async () => {
  const { page, context } = await openPage("/", { draft: "text" });
  await page.focus("#dragHandle");
  const before = Number(await page.getAttribute("#dragHandle", "aria-valuenow"));
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  const after = Number(await page.getAttribute("#dragHandle", "aria-valuenow"));
  assert.equal(after, before - 4);
  assert.equal(await page.evaluate(() => localStorage.getItem("md-preview-split")), await page.evaluate(() =>
    document.getElementById("splitPane").style.getPropertyValue("--split-left")
  ));
  await page.keyboard.press("End");
  const end = Number(await page.getAttribute("#dragHandle", "aria-valuenow"));
  assert.ok(end < 100 && end > after, `End went to ${end}`);
  await context.close();
});

test("a second tab follows the draft, and a theme change there does not overwrite it", async () => {
  const { page: first, context } = await openPage("/", { draft: "old text" });
  const second = await context.newPage();
  second.on("dialog", (dialog) => dialog.accept());
  await second.goto(BASE);
  assert.equal(await second.inputValue("#markdownInput"), "old text");

  await first.fill("#markdownInput", "new text from the first tab");
  await second.waitForFunction(() => document.getElementById("markdownInput").value === "new text from the first tab");
  await second.click("#darkMode");
  await second.waitForTimeout(200);
  assert.equal(await second.evaluate(() => localStorage.getItem("md-preview-content")), "new text from the first tab");

  await first.reload();
  assert.equal(await first.inputValue("#markdownInput"), "new text from the first tab");
  await context.close();
});

test("Reset does not replace text typed while the sample loads", async () => {
  let releaseSample;
  const sampleHeld = new Promise((resolve) => (releaseSample = resolve));
  const { page, context } = await openPage("/", {
    draft: "my draft",
    beforeGoto: (page) =>
      page.route("**/sample.md", async (route) => {
        await sampleHeld;
        await route.continue();
      }),
  });
  await page.click("#resetBtn"); // the confirm is accepted by openPage
  await page.fill("#markdownInput", "typed during Reset");
  releaseSample();
  await page.waitForResponse("**/sample.md");
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue("#markdownInput"), "typed during Reset");
  assert.equal(await page.evaluate(() => localStorage.getItem("md-preview-content")), "typed during Reset");
  assert.match(await page.textContent("#status"), /Reset cancelled/);
  await context.close();
});

test("a link to a heading lands on it", async () => {
  const { page, context } = await openPage("/", { draft: "[Go](#second-part)\n\n# First\n\n# Second part" });
  const href = await page.getAttribute("#preview a", "href");
  assert.equal(href, "#user-content-second-part");
  assert.equal(await page.evaluate((id) => document.getElementById(id)?.textContent, href.slice(1)), "Second part");
  await context.close();
});

test("a large draft is saved on every change, even while rendering is deferred", async () => {
  const big = Array.from({ length: 3000 }, (_, i) => `## Heading ${i}\n\nSome **bold** and [a link](#heading-${i}) and ==mark==.`).join("\n\n");
  const { page, context } = await openPage("/", { draft: big });
  await page.focus("#markdownInput");
  await page.keyboard.press("End");
  await page.keyboard.type("XYZ");
  assert.ok((await page.evaluate(() => localStorage.getItem("md-preview-content"))).endsWith("XYZ"));
  await page.waitForFunction(() => document.getElementById("preview").textContent.includes("XYZ"));
  await context.close();
});

/** Opens the Export menu and picks an item, returning the download it starts. */
async function exportAs(page, kind) {
  await page.click("#exportBtn");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click(`[data-export="${kind}"]`)]);
  return download;
}

async function downloadedText(download) {
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const EXPORT_DRAFT = [
  "# Quarterly notes",
  "",
  "Some $x^2$ math and an image:",
  "",
  '<img src="/favicon-32x32.png" alt="icon">',
  "",
  "```mermaid",
  "graph LR",
  "  A --> B",
  "```",
].join("\n");

test("Export downloads the markdown as it is, named after the title and the time", async () => {
  const { page, context } = await openPage("/", { draft: EXPORT_DRAFT });
  const download = await exportAs(page, "md");
  // Title, then local date and time: two exports never overwrite each other.
  assert.match(download.suggestedFilename(), /^quarterly-notes_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.md$/);
  assert.equal(await downloadedText(download), EXPORT_DRAFT);
  await context.close();
});

test("Export as HTML gives one light, script-free file that works offline", async () => {
  const { page, context } = await openPage("/", { draft: EXPORT_DRAFT });
  await page.click("#darkMode"); // the page is dark; the export must not be
  await page.waitForSelector("#preview .mermaid-diagram svg", { timeout: 10_000 });
  const html = await downloadedText(await exportAs(page, "html"));
  assert.match(html, /<html lang="en" data-theme="light">/);
  assert.match(html, /<title>Quarterly notes<\/title>/);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /class="katex/);
  assert.match(html, /data:font\/woff2;base64,/, "KaTeX fonts are embedded");
  assert.match(html, /<img src="data:image\/png;base64,/, "this site's images are embedded");
  assert.match(html, /<svg/);
  assert.match(html, /#ececff/i, "diagrams are drawn in the light theme");
  await context.close();
});

test("Export as HTML makes links absolute and keeps the embedded image, even at 2x", async () => {
  const draft = [
    "# Portable",
    "",
    "[Root](/) [Readme](readme.md) [Down](#portable) [Mail](mailto:a@example.com)",
    "",
    '<img src="/favicon-32x32.png" srcset="/favicon-16x16.png 1x, /android-chrome-192x192.png 2x" alt="icon">',
  ].join("\n");
  const { page, context } = await openPage("/", { draft, scale: 2 });
  const html = await downloadedText(await exportAs(page, "html"));
  assert.match(html, new RegExp(`href="${BASE}/"`));
  assert.match(html, new RegExp(`href="${BASE}/readme.md"`));
  assert.match(html, /href="#user-content-portable"/);
  assert.match(html, /href="mailto:a@example.com"/);
  assert.doesNotMatch(html, /srcset/);

  // Opened as a file would be: nothing to resolve against, on a 2x screen.
  const file = await context.newPage();
  await file.setContent(html);
  const image = await file.evaluate(() => document.querySelector("img").currentSrc);
  assert.match(image, /^data:image\/png;base64,/);
  await context.close();
});

test("one export at a time: a second one waits its turn instead of swapping the document", async () => {
  let releaseKatex;
  const katexHeld = new Promise((resolve) => (releaseKatex = resolve));
  const { page, context } = await openPage("/", {
    draft: "# Document A\n\nMath $x^2$.",
    waitUntil: "domcontentloaded",
    beforeGoto: (page) =>
      page.route("**/vendor/katex/katex.css", async (route) => {
        await katexHeld;
        await route.continue();
      }),
  });
  const html = page.waitForEvent("download");
  await page.click("#exportBtn");
  await page.click('[data-export="html"]');
  await page.fill("#markdownInput", "# Document B");
  await page.click("#exportBtn");
  await page.click('[data-export="md"]');
  assert.match(await page.textContent("#status"), /already in progress/);
  releaseKatex();
  const download = await html;
  assert.match(download.suggestedFilename(), /^document-a_/);
  assert.match(await downloadedText(download), /<title>Document A<\/title>/);
  await context.close();
});

test("Export as PDF waits for images before printing", async () => {
  let releaseImage;
  const imageHeld = new Promise((resolve) => (releaseImage = resolve));
  const { page, context } = await openPage("/", {
    draft: '# Pictures\n\n<img src="/favicon-32x32.png?slow" alt="slow">',
    waitUntil: "domcontentloaded",
    beforeGoto: (page) =>
      page.route(/favicon-32x32\.png\?slow$/, async (route) => {
        await imageHeld;
        await route.continue();
      }),
  });
  await page.waitForSelector("#preview img", { state: "attached" });
  await page.evaluate(() => {
    window.print = () => {
      const image = document.querySelector("#exportArea img");
      window.__printed = { complete: image.complete, width: image.naturalWidth };
    };
  });
  await page.click("#exportBtn");
  await page.click('[data-export="pdf"]');
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__printed), undefined, "printed before the image arrived");
  releaseImage();
  await page.waitForFunction(() => window.__printed !== undefined, null, { timeout: 10_000 });
  const printed = await page.evaluate(() => window.__printed);
  assert.equal(printed.complete, true);
  assert.ok(printed.width > 0);
  await context.close();
});

test("Export as PDF prints a light copy of the document, even from the dark theme", async () => {
  const { page, context } = await openPage("/", { draft: EXPORT_DRAFT });
  await page.click("#darkMode");
  await page.evaluate(() => {
    window.print = () => {
      window.__printedTitle = document.title;
    };
  });
  await page.click("#exportBtn");
  await page.click('[data-export="pdf"]');
  await page.waitForFunction(() => window.__printedTitle !== undefined, null, { timeout: 10_000 });
  assert.match(await page.evaluate(() => window.__printedTitle), /^quarterly-notes_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/);
  assert.equal(await page.evaluate(() => document.body.classList.contains("is-printing")), true);
  const exportSvg = await page.evaluate(() => document.querySelector("#exportArea .mermaid-diagram svg")?.outerHTML ?? "");
  assert.match(exportSvg, /#ececff/i, "the printed diagram is light");
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.isVisible("#exportArea"), true);
  assert.equal(await page.isVisible(".backdrop"), false);
  await context.close();
});

test("the shared page's Export menu opens over the document and works", async () => {
  const created = await (
    await fetch(`${BASE}/api/shares`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: EXPORT_DRAFT }),
    })
  ).json();
  const { page, context } = await openPage(`/${created.id}`);
  const download = await exportAs(page, "md");
  assert.equal(await downloadedText(download), EXPORT_DRAFT);
  await page.click("#exportBtn");
  assert.equal(await page.getAttribute("#rawLink", "href"), created.markdownUrl);
  await page.keyboard.press("Escape");
  assert.equal(await page.isHidden("#exportMenu"), true);
  await context.close();
});
