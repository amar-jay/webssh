import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
const release = JSON.parse(
  await readFile(new URL("../release.json", import.meta.url)),
);
const origin = process.argv[2] || "https://ssh.amarjay.com";
assert.equal(new URL(origin).protocol, "https:");
const get = (path) =>
  fetch(origin + path, {
    redirect: "manual",
    signal: AbortSignal.timeout(60000),
  });
const health = await get("/api/health");
assert.equal(health.status, 200);
assert.match(health.headers.get("cache-control"), /no-store/);
assert.deepEqual(await health.json(), {
  app: "ok",
  state: "ok",
  protocol: release.protocol,
  bridge: release.bridge,
  release: release.version,
});
const root = await get("/");
assert.equal(root.status, 200);
assert.match(root.headers.get("content-security-policy"), /wasm-unsafe-eval/);
assert.equal(root.headers.get("referrer-policy"), "same-origin");
const landing = await root.text();
const publicIndexing =
  origin === "https://ssh.amarjay.com" ? /^index, follow/ : /^noindex/;
assert.match(root.headers.get("x-robots-tag"), publicIndexing);
assert.ok(landing.includes('rel="canonical" href="https://ssh.amarjay.com/"'));
assert.ok(landing.includes('property="og:title"'));
assert.ok(landing.includes('name="twitter:card"'));
const robots = await get("/robots.txt");
assert.equal(robots.status, 200);
assert.match(
  await robots.text(),
  /Sitemap: https:\/\/ssh\.amarjay\.com\/sitemap\.xml/,
);
const sitemap = await get("/sitemap.xml");
assert.equal(sitemap.status, 200);
const sitemapXML = await sitemap.text();
assert.match(sitemapXML, /<loc>https:\/\/ssh\.amarjay\.com\/help<\/loc>/);
assert.doesNotMatch(sitemapXML, /\/machines|\/s\/|\/pair/);
for (const [href, label] of [
  ["/machines", "Machines"],
  ["/pair", "Pair"],
  ["/help", "Help"],
])
  assert.match(
    landing,
    new RegExp(`href="${href}"[^>]*>${label}<`),
    `landing tab ${label} must link to ${href}`,
  );
for (const marker of [
  'rel="icon" href="/favicon.ico"',
  'type="image/svg+xml"',
  'rel="apple-touch-icon"',
  'rel="manifest"',
])
  assert.ok(landing.includes(marker), `landing head is missing ${marker}`);
// Exercise form-origin checks without an authenticated session or user cookies.
for (const requestOrigin of [origin, "null", "https://untrusted.example"]) {
  const logout = await fetch(origin + "/logout", {
    method: "POST",
    redirect: "manual",
    body: "",
    headers: {
      origin: requestOrigin,
      "content-type": "application/x-www-form-urlencoded",
    },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(logout.status, requestOrigin === origin ? 303 : 403);
}
const session = await get("/s/release_smoke");
assert.equal(session.status, 303);
assert.match(session.headers.get("x-robots-tag"), /^noindex/);
assert.match(session.headers.get("location"), /^\/login\?/);
const help = await get("/help");
assert.equal(help.status, 200);
const helpHtml = await help.text();
assert.match(help.headers.get("x-robots-tag"), publicIndexing);
assert.ok(
  helpHtml.includes('rel="canonical" href="https://ssh.amarjay.com/help"'),
);
assert.match(helpHtml, /How do I pair a machine/);
assert.match(helpHtml, /aria-current="page">Help</, "help tab is current");
assert.match(helpHtml, /log_level/);
assert.doesNotMatch(helpHtml, /LOG_LEVEL|LOG_FORMAT|NO_COLOR/);
for (const path of ["/machines", "/machines/release_smoke"]) {
  const response = await fetch(origin + path, {
    redirect: "manual",
    headers: { cookie: "webssh_dev=1" },
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, 303);
  assert.match(response.headers.get("location"), /^\/login/);
}
for (const path of ["/dashboard", "/sessions"]) {
  const response = await get(path);
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/machines");
}
const approvalPage = await get("/attach?code=ABCDEFGH");
assert.equal(approvalPage.status, 303);
assert.match(approvalPage.headers.get("location"), /^\/login/);
// Synthetic, unapproved request only: no user's session or credentials are used.
const cliPost = (path, body) =>
  fetch(origin + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
const started = await cliPost("/api/cli/attach/start", {
  sessionId: "release_smoke_session",
});
assert.equal(started.status, 200);
assert.match(started.headers.get("cache-control"), /no-store/);
const attempt = await started.json();
assert(/^[A-Z0-9]{8}$/.test(attempt.code), "Invalid CLI approval code");
assert(
  /^[A-Za-z0-9_-]{32}$/.test(attempt.cliSecret),
  "Invalid CLI polling secret",
);
assert.equal(attempt.url, origin + "/attach?code=" + attempt.code);
const polled = await cliPost("/api/cli/attach/poll", {
  code: attempt.code,
  cliSecret: attempt.cliSecret,
});
assert.equal(polled.status, 200);
assert.equal((await polled.json()).status, "pending");
const rejected = await cliPost("/api/cli/attach/poll", {
  code: attempt.code,
  cliSecret:
    (attempt.cliSecret[0] === "A" ? "B" : "A") + attempt.cliSecret.slice(1),
});
assert.equal(rejected.status, 401);
const installer = await get("/install.sh");
assert.equal(installer.status, 200);
assert.match(installer.headers.get("cache-control"), /no-store/);
assert.equal(
  await installer.text(),
  await readFile(new URL("./install.sh", import.meta.url), "utf8"),
);
for (const [path, type] of [
  ["/favicon.ico", /image\/(x-icon|vnd\.microsoft\.icon)/],
  ["/icon.svg", /image\/svg\+xml/],
  ["/apple-touch-icon.png", /image\/png/],
  ["/icon-192.png", /image\/png/],
  ["/icon-maskable-512.png", /image\/png/],
]) {
  const icon = await get(path);
  assert.equal(icon.status, 200, `${path} must be served`);
  assert.match(
    icon.headers.get("content-type") ?? "",
    type,
    `${path} content type`,
  );
  assert.ok(
    (await icon.arrayBuffer()).byteLength > 256,
    `${path} is not empty`,
  );
}
const webManifestResponse = await get("/manifest.webmanifest");
assert.equal(webManifestResponse.status, 200);
const webManifest = await webManifestResponse.json();
assert.equal(webManifest.short_name, "WebSSH");
assert.equal(webManifest.id, "/");
assert.equal(webManifest.display, "standalone");
assert.ok(webManifest.icons.some((icon) => icon.purpose === "maskable"));
assert.ok(webManifest.icons.some((icon) => icon.src === "/icon.svg"));
const dev = await get("/dev/connect");
assert.equal(dev.status, 404);
const m = await get("/tailcat/build.json");
assert.equal(m.status, 200);
assert.match(m.headers.get("cache-control"), /no-store/);
const manifest = await m.json();
assert.equal(manifest.protocolVersion, 2);
assert.equal(manifest.bridgeVersion, 1);
assert.match(manifest.assetDir, /^[a-f0-9]{32}$/);
for (const [file, key] of [
  ["wasm_exec.js", "runtimeSHA256"],
  ["webssh.wasm.gz", "wasmSHA256"],
]) {
  const response = await get("/tailcat/" + manifest.assetDir + "/" + file);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /immutable/);
  let bytes = Buffer.from(await response.arrayBuffer());
  if (file.endsWith(".gz") && bytes[0] === 31 && bytes[1] === 139)
    bytes = gunzipSync(bytes);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), manifest[key]);
  if (file.endsWith(".gz")) assert(await WebAssembly.compile(bytes));
}
console.log(
  "Production app/state, auth gates, CSP and matched WASM/runtime assets passed. Relay/agent attachment is a separate gate.",
);
