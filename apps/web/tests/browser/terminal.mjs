// Invoked by the opt-in native agent integration test. Never print credentials.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { resolve } from "node:path";
const [recordFile, workspace] = process.argv.slice(2);
const descriptor = JSON.parse(await readFile(recordFile, "utf8"));
const port = await new Promise((resolve) => {
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const vite = spawn(
  "pnpm",
  [
    "exec",
    "vite",
    "dev",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ],
  { cwd: resolve(import.meta.dirname, "../.."), stdio: "ignore" },
);
let browser, page;
async function until(check, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  await until(async () => {
    try {
      return (await fetch(origin)).ok;
    } catch {
      return false;
    }
  }, "web startup");
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || "/snap/bin/chromium",
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--ignore-certificate-errors",
    ],
  });
  page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
    ignoreHTTPSErrors: true,
  });
  const errors = [];
  page.on("pageerror", () => {
    errors.push("browser error");
  });
  const text = () => page.locator(".xterm-accessibility").innerText();
  async function see(value) {
    await until(async () => {
      try {
        const content = await text();
        return content.includes(value);
      } catch {
        return false;
      }
    }, value);
  }
  async function command(value) {
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  }
  async function connect(record) {
    await page.goto(origin + "/dev/connect");
    await page.locator("#record").fill(JSON.stringify(record));
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.waitForURL(/\/s\/[a-z0-9-]+$/);
    assert(!page.url().includes(record.token));
  }
  await connect({
    ...descriptor,
    token: "invalid-token-that-is-long-enough-to-pass-form",
  });
  await see("Connection failed.");
  await connect(descriptor);
  await see("Connected.");
  await command("cat unicode.txt");
  await see("TAILCAT_BROWSER_OK café İstanbul 日本語");
  // Exercise xterm's actual paste handler, including a multi-line paste.
  await page.locator(".xterm-helper-textarea").evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "printf 'paste-one\\n' > paste.txt\nprintf 'paste-two\\n' >> paste.txt\n",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  await until(async () => {
    try {
      return (
        (await readFile(resolve(workspace, "paste.txt"), "utf8")) ===
        "paste-one\npaste-two\n"
      );
    } catch {
      return false;
    }
  }, "multi-line paste");
  await command("sleep 30");
  await new Promise((r) => setTimeout(r, 150));
  await page.keyboard.press("Control+c");
  await command("cat interrupt.txt");
  await see("INTERRUPT_OK");
  await page.setViewportSize({ width: 740, height: 460 });
  await new Promise((r) => setTimeout(r, 150));
  await command("stty size > dimensions.txt");
  await until(async () => {
    try {
      return /^\d+ \d+\s*$/.test(
        await readFile(resolve(workspace, "dimensions.txt"), "utf8"),
      );
    } catch {
      return false;
    }
  }, "terminal resize");
  const [rows, cols] = (
    await readFile(resolve(workspace, "dimensions.txt"), "utf8")
  )
    .trim()
    .split(" ")
    .map(Number);
  assert(rows > 5 && rows < 40 && cols > 20 && cols < 100);
  await command("vi -u NONE -i NONE browser.txt; printf done > editor.done");
  await new Promise((r) => setTimeout(r, 400));
  await page.keyboard.press("i");
  await page.keyboard.type("FULLSCREEN_OK");
  await page.keyboard.press("Escape");
  await page.keyboard.type(":wq");
  await page.keyboard.press("Enter");
  await until(async () => {
    try {
      return (
        await readFile(resolve(workspace, "browser.txt"), "utf8")
      ).includes("FULLSCREEN_OK");
    } catch {
      return false;
    }
  }, "full-screen editor");
  await until(async () => {
    try {
      return (
        (await readFile(resolve(workspace, "editor.done"), "utf8")) === "done"
      );
    } catch {
      return false;
    }
  }, "editor exit");
  await command("exit 7");
  await see("Shell exited (7).");
  // The single-use development handoff is gone after reload. The normal
  // resolver must require authentication, rather than replaying credentials.
  let grantRequests = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.endsWith("/grant") &&
      request.method() === "POST"
    )
      grantRequests++;
  });
  const choicesResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/choices") &&
      response.request().method() === "GET",
  );
  await page.reload();
  assert.equal((await choicesResponse).status(), 401);
  await page
    .getByRole("status")
    .filter({
      hasText: "Sign in again, then reload this page.",
    })
    .waitFor();
  assert.equal(
    grantRequests,
    0,
    "reload must not request a grant without authorization and selection",
  );

  // Exercise the real centered picker with test-only metadata. Grant requests
  // still receive 401: these fixtures never authorize a shell or reuse the dev token.
  const referenceId = new URL(page.url()).pathname.split("/").at(-1);
  const existingId = "picker_existing_1234567890";
  const newId = "picker_created_1234567890";
  const choicesRoute = "**/api/sessions/*/choices";
  const grantsRoute = "**/api/sessions/*/grant";
  let creates = 0;
  let pickerReads = 0;
  const selectedIds = [];
  await page.route(choicesRoute, async (route) => {
    if (route.request().method() === "POST") {
      creates++;
      await route.fulfill({ status: 201, json: { sessionId: newId } });
    } else {
      pickerReads++;
      await route.fulfill({
        json: {
          backend: "tmux",
          workspace: "Browser test workspace",
          online: true,
          sessions: [referenceId, existingId].map((id) => ({
            id,
            // Reload can retain the old controller until its disconnect arrives.
            status:
              id === existingId && pickerReads < 3 ? "active" : "connecting",
            createdAt: 1,
          })),
        },
      });
    }
  });
  await page.route(grantsRoute, async (route) => {
    selectedIds.push(new URL(route.request().url()).pathname.split("/").at(-2));
    await route.fulfill({ status: 401, json: { error: "unauthorized" } });
  });
  try {
    await page.reload();
    const picker = page.getByRole("region", {
      name: "Terminal sessions",
      exact: true,
    });
    const rows = picker
      .getByRole("list", { name: "Workspace sessions" })
      .getByRole("button");
    await rows.nth(1).waitFor();
    assert.equal(grantRequests, 0, "showing the picker must not mint a grant");
    assert.equal(creates, 0, "showing the picker must not create a session");
    await page.keyboard.press("ArrowDown");
    await until(
      async () => (await rows.nth(1).getAttribute("aria-current")) === "true",
      "picker keyboard selection",
    );
    const existingGrant = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
        `/api/sessions/${existingId}/grant`,
    );
    await page.keyboard.press("Enter");
    await picker
      .getByRole("status")
      .filter({ hasText: "Waiting for the previous connection" })
      .waitFor();
    assert.equal((await existingGrant).status(), 401);
    await page
      .getByRole("status")
      .filter({ hasText: "Sign in at /" })
      .waitFor();
    assert.deepEqual(selectedIds, [existingId]);

    await page.reload();
    await rows.nth(1).waitFor();
    assert.equal(creates, 0);
    assert.equal(grantRequests, 1);
    const newGrant = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/sessions/${newId}/grant`,
    );
    await picker
      .getByRole("button", { name: "New session", exact: true })
      .click();
    assert.equal((await newGrant).status(), 401);
    await page
      .getByRole("status")
      .filter({ hasText: "Sign in at /" })
      .waitFor();
    assert.equal(creates, 1);
    assert.deepEqual(selectedIds, [existingId, newId]);
  } finally {
    await page.unroute(choicesRoute);
    await page.unroute(grantsRoute);
  }
  await connect(descriptor);
  await see("Connected.");
  await command("echo $$ > shell.pid");
  await until(async () => {
    try {
      await access(resolve(workspace, "shell.pid"));
      return true;
    } catch {
      return false;
    }
  }, "shell PID");
  const pid = Number(
    (await readFile(resolve(workspace, "shell.pid"), "utf8")).trim(),
  );
  await page.goBack();
  await page.waitForURL(/\/dev\/connect$/);
  await until(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error.code === "ESRCH";
    }
  }, "route disposal reaps shell");
  assert.equal(errors.length, 0);
  console.log(
    "Browser/DERP/native PTY: auth, Unicode, paste, Ctrl+C, resize, vi, exit, picker selection, reload authorization and disposal passed.",
  );
} catch (error) {
  console.error(
    "Browser terminal integration failed; terminal contents omitted.",
  );
  throw error;
} finally {
  await browser?.close();
  vite.kill("SIGTERM");
}
