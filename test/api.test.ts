import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { BASE, call, fromAddress, post, readJson, uniqueAddress } from "./helpers.js";
import { newId } from "../src/ids.js";
import { sweep } from "../src/index.js";
import { MAX_CONTENT_BYTES, RATE_LIMITS, SHARE_TTL_MS } from "../src/limits.js";

const SAMPLE = "# Weekly notes\n\nПривет, **мир**.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";

async function create(content = SAMPLE) {
  const response = await post("/api/shares", { content });
  expect(response.status).toBe(201);
  return readJson(response);
}

/** Moves a share's deadline, the way time would. */
async function expire(id: string) {
  await env.DB.prepare("UPDATE shares SET expires_at = ? WHERE id = ?").bind(Date.now() - 1, id).run();
}

describe("creating a share", () => {
  it("returns the three links, the deadline and a delete token", async () => {
    const before = Date.now();
    const share = await create();

    expect(share.url).toBe(`${BASE}/${share.id}`);
    expect(share.markdownUrl).toBe(`${BASE}/${share.id}.md`);
    expect(share.jsonUrl).toBe(`${BASE}/${share.id}.json`);
    expect(share.sizeBytes).toBe(new TextEncoder().encode(SAMPLE).byteLength);
    expect(typeof share.deleteToken).toBe("string");

    const lifetime = Date.parse(share.expiresAt) - Date.parse(share.createdAt);
    expect(lifetime).toBe(SHARE_TTL_MS);
    expect(Date.parse(share.createdAt)).toBeGreaterThanOrEqual(before - 1);
  });

  it("stores the delete token only as a hash", async () => {
    const share = await create();
    const row = await env.DB.prepare("SELECT * FROM shares WHERE id = ?").bind(share.id).first();
    expect(JSON.stringify(row)).not.toContain(share.deleteToken);
  });

  it("refuses empty, missing and non-string content", async () => {
    for (const content of ["", "   \n\t", undefined, 42, ["# hi"]]) {
      expect((await post("/api/shares", { content })).status).toBe(400);
    }
  });

  it("measures the limit in UTF-8 bytes, not characters", async () => {
    // Cyrillic is two bytes a character: this is under the limit in characters, over it in bytes.
    const content = "я".repeat(MAX_CONTENT_BYTES / 2 + 1);
    const response = await post("/api/shares", { content });
    expect(response.status).toBe(413);

    expect((await post("/api/shares", { content: "я".repeat(MAX_CONTENT_BYTES / 2) })).status).toBe(201);
  });

  /** A CORS-safelisted type would let any page on the web create shares from its visitors. */
  it("requires application/json", async () => {
    const response = await call("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "text/plain;foo=application/json" },
      body: JSON.stringify({ content: SAMPLE })
    });
    expect(response.status).toBe(415);
  });

  it("refuses a body over the cap without buffering it", async () => {
    const response = await call("/api/shares", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(MAX_CONTENT_BYTES * 5) })
    });
    expect(response.status).toBe(413);
  });

  it("only accepts POST", async () => {
    expect((await call("/api/shares")).status).toBe(405);
  });
});

describe("reading a share", () => {
  it("serves the markdown byte for byte at /{id}.md", async () => {
    const content = "# Title\r\n\n<script>alert(1)</script>\n\n```js\nconst x = `y`;\n```\n  trailing  \n";
    const share = await create(content);
    const response = await call(`/${share.id}.md`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="${share.id}.md"`);
    expect(response.headers.get("link")).toBe(`<${share.url}>; rel="canonical"`);
    expect(await response.text()).toBe(content);
  });

  it("serves the markdown with its metadata at /{id}.json", async () => {
    const share = await create();
    const response = await call(`/${share.id}.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");

    const body = await readJson(response);
    expect(body).toEqual({
      id: share.id,
      url: share.url,
      markdownUrl: share.markdownUrl,
      jsonUrl: share.jsonUrl,
      title: "Weekly notes",
      sizeBytes: share.sizeBytes,
      createdAt: share.createdAt,
      expiresAt: share.expiresAt,
      content: SAMPLE
    });
  });

  it("lets other origins fetch the raw representations", async () => {
    const share = await create();
    for (const suffix of [".md", ".json"]) {
      expect((await call(`/${share.id}${suffix}`)).headers.get("access-control-allow-origin")).toBe("*");
    }
  });

  it("keeps every representation out of search engines and caches", async () => {
    const share = await create();
    for (const suffix of ["", ".md", ".json"]) {
      const response = await call(`/${share.id}${suffix}`);
      expect(response.headers.get("x-robots-tag")).toContain("noindex");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });

  /** Unknown, expired and deleted are one answer, so the URLs are not an oracle. */
  it("answers 404 for an expired share, even before the sweep has run", async () => {
    const share = await create();
    await expire(share.id);

    const unknown = newId();
    for (const suffix of ["", ".md", ".json"]) {
      const expired = await call(`/${share.id}${suffix}`);
      const never = await call(`/${unknown}${suffix}`);
      expect(expired.status).toBe(404);
      expect(never.status).toBe(404);
      if (suffix === ".md") expect(await expired.text()).toBe(await never.text());
    }
  });

  it("is not changed by being read", async () => {
    const share = await create();
    for (let i = 0; i < 5; i++) expect((await call(`/${share.id}.md`)).status).toBe(200);
    expect((await call(`/${share.id}`)).status).toBe(200);
  });
});

describe("deleting a share", () => {
  function remove(id: string, deleteToken: unknown) {
    return call(`/api/shares/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteToken })
    });
  }

  it("needs the token it was created with", async () => {
    const share = await create();

    expect((await remove(share.id, "not-the-token")).status).toBe(404);
    expect((await remove(share.id, undefined)).status).toBe(400);
    expect((await call(`/${share.id}.md`)).status).toBe(200);

    const response = await remove(share.id, share.deleteToken);
    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ deleted: true });
    expect((await call(`/${share.id}.md`)).status).toBe(404);

    // Already gone.
    expect((await remove(share.id, share.deleteToken)).status).toBe(404);
  });

  it("does not accept one share's token for another", async () => {
    const first = await create();
    const second = await create();
    expect((await remove(second.id, first.deleteToken)).status).toBe(404);
    expect((await call(`/${second.id}.md`)).status).toBe(200);
  });

  it("refuses an id this service could not have issued", async () => {
    expect((await remove("not-an-id", "x")).status).toBe(404);
  });
});

describe("the retention sweep", () => {
  it("deletes expired rows and leaves live ones", async () => {
    const live = await create();
    const old = await create();
    await expire(old.id);

    expect(await sweep(env)).toBeGreaterThanOrEqual(1);
    const ids = (await env.DB.prepare("SELECT id FROM shares").all()).results.map((row) => row.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(old.id);
  });
});

describe("rate limiting", () => {
  it("allows a burst of creates up to the minute limit and refuses the next", async () => {
    const address = uniqueAddress();
    const send = () =>
      fromAddress(address, "/api/shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: SAMPLE })
      });

    for (let i = 0; i < RATE_LIMITS.writeMinute.limit; i++) expect((await send()).status).toBe(201);

    const refused = await send();
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await readJson(refused)).code).toBe("rate_limited");
  });

  /** Reading is a primary-key lookup; a recipient must never be locked out by the author's office. */
  it("does not meter reading", async () => {
    const share = await create();
    const address = uniqueAddress();
    for (let i = 0; i < RATE_LIMITS.other.limit + 5; i++) {
      expect((await fromAddress(address, `/${share.id}.md`)).status).toBe(200);
    }
  });
});
