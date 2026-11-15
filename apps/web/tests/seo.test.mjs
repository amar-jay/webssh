import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { indexablePage, publicPages, siteOrigin } from "../src/lib/seo.ts";

test("only successful public HTML on the production origin is indexable", () => {
  for (const path of Object.keys(publicPages))
    assert(
      indexablePage(new URL(path, siteOrigin), 200, "text/html; charset=utf-8"),
    );
  for (const path of [
    "/s/private",
    "/machines",
    "/pair",
    "/attach",
    "/api/health",
    "/login",
    "/?error=oauth_failed",
  ])
    assert.equal(
      indexablePage(new URL(path, siteOrigin), 200, "text/html"),
      false,
    );
  assert.equal(
    indexablePage(new URL("/", siteOrigin), 500, "text/html"),
    false,
  );
  assert.equal(
    indexablePage(new URL("/", siteOrigin), 200, "application/json"),
    false,
  );
  assert.equal(
    indexablePage(
      new URL("https://webssh-web.example.workers.dev/"),
      200,
      "text/html",
    ),
    false,
  );
});

test("sitemap and crawler discovery cover exactly the public canonical pages", async () => {
  const xml = await readFile("static/sitemap.xml", "utf8");
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(
    urls,
    Object.keys(publicPages).map((path) => siteOrigin + path),
  );
  const robots = await readFile("static/robots.txt", "utf8");
  assert.match(robots, /Allow: \/\s/);
  assert.match(robots, /Sitemap: https:\/\/ssh\.amarjay\.com\/sitemap\.xml/);
  assert.doesNotMatch(robots, /Disallow: \/\s/);
});
