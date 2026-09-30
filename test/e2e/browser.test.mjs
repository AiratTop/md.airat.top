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
 * Google Analytics is replaced by a stub that counts what a real gtag.js would see, so
 * the suite needs no network and sends nothing to Google.
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
  await browser?.close();
  if (server) process.kill(-server.pid);
});

/**
 * A fresh page with GA stubbed. The stub listens for clicks the way enhanced measurement
 * does — on window and document, capture and bubble — and counts them.
 */
async function openPage(path = "/", { blockStorage = false, draft } = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `window.__gaClicks = [];
        for (const target of [window, document]) for (const capture of [true, false])
          target.addEventListener("click", (e) => window.__gaClicks.push(e.target.textContent), capture);`,
    })
  );
  await context.route(/google-analytics\.com/, (route) => route.abort());
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

test("clicks inside rendered markdown never reach analytics", async () => {
  const { page, context } = await openPage("/", { draft: "[Private](https://example.com/private?token=SECRET)" });
  await page.waitForFunction(() => Array.isArray(window.__gaClicks));
  await page.click("#preview a", { modifiers: ["Meta"] }).catch(() => {});
  await page.click("#preview", { position: { x: 5, y: 5 } });
  await page.click("#copyBtn");
  const seen = await page.evaluate(() => window.__gaClicks);
  assert.ok(!seen.some((text) => text.includes("Private")), `analytics saw a document click: ${seen}`);
  assert.ok(seen.includes("Copy"), "the stub should still see clicks outside the document");
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
