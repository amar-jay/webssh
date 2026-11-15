import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { resolve } from "node:path";
import { signSession } from "../src/lib/auth/session.ts";
async function moduleAt(path, plugins = []) {
  const result = await build({
    entryPoints: [resolve(path)],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    define: { "import.meta.env.DEV": "false" },
    plugins,
  });
  return import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
}
const hook = await moduleAt("src/hooks.server.ts");
const grant = await moduleAt(
  "src/routes/api/sessions/[session_id]/grant/+server.ts",
);
const approve = await moduleAt("src/routes/api/pairing/approve/+server.ts");
const secret = "abcdefghijklmnopqrstuvwxyz012345";
const env = {
  GITHUB_CLIENT_ID: "test",
  GITHUB_CLIENT_SECRET: "test",
  SESSION_SECRET: secret,
  PUBLIC_ORIGIN: "https://webssh.example",
};

test("pairing page reads Worker bindings when platform is absent", async () => {
  const pair = await moduleAt("src/routes/pair/+page.server.ts", [
    {
      name: "worker-bindings",
      setup(build) {
        build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: "bindings",
          namespace: "test",
        }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: `
    export const env = { WEBSSH_STATE: {
     idFromName: name => name,
     get: name => ({ previewPairing: async (code, owner) => {
      if (name !== 'pairing' || code !== 'ABCDEFGH' || owner !== '42') throw Error('unexpected request');
      return { machineName: 'production-box' };
     } })
    } };
   `,
        }));
      },
    },
  ]);
  const result = await pair.load({
    url: new URL("https://webssh.example/pair?code=abcd-efgh"),
    locals: { user: { ownerId: "42" } },
  });
  assert.equal(result.error, null);
  assert.equal(result.machineName, "production-box");
  assert.equal(result.code, "ABCDEFGH");
});

test("hook authenticates against stored owner session and rejects foreign-origin mutations", async () => {
  const token = await signSession(
    { sid: "session", oid: "42", exp: Math.floor(Date.now() / 1000) + 60 },
    secret,
  );
  let revoked = false;
  const namespace = {
    idFromName: (name) => {
      assert.equal(name, "owner:42");
      return name;
    },
    get: () => ({
      getBrowserSession: async () =>
        revoked ? null : { ownerId: "42", expiresAt: Date.now() + 60000 },
    }),
  };
  const event = {
    locals: {},
    url: new URL("https://webssh.example/"),
    platform: { env: { ...env, WEBSSH_STATE: namespace } },
    request: new Request("https://webssh.example/", {
      headers: { cookie: `__Host-webssh_session=${token}` },
    }),
  };
  await hook.handle({ event, resolve: async () => new Response("ok") });
  assert.equal(event.locals.user.ownerId, "42");
  revoked = true;
  await hook.handle({ event, resolve: async () => new Response("ok") });
  assert.equal(event.locals.user, null);
  event.request = new Request("https://webssh.example/api/pairing/approve", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      cookie: `__Host-webssh_session=${token}`,
    },
  });
  assert.equal(
    (
      await hook.handle({
        event,
        resolve: async () => {
          throw Error("must not resolve");
        },
      })
    ).status,
    403,
  );
});

test("grant routing uses authenticated owner and hides foreign sessions", async () => {
  const namespace = {
    idFromName: (name) => {
      assert.equal(name, "owner:owner2");
      return name;
    },
    get: () => ({
      getTerminalSession: async (owner, id) => {
        assert.equal(owner, "owner2");
        assert.equal(id, "foreign");
        return null;
      },
    }),
  };
  const event = {
    locals: { user: { ownerId: "owner2", sessionId: "browser" } },
    params: { session_id: "foreign" },
    platform: { env: { WEBSSH_STATE: namespace } },
  };
  assert.equal((await grant.POST(event)).status, 404);
  event.locals.user = null;
  assert.equal((await grant.POST(event)).status, 401);
});

test("failed pairing completion revokes orphan registration and aborts claim", async () => {
  const actions = [];
  const namespace = {
    idFromName: (name) => name,
    get: (name) =>
      name === "pairing"
        ? {
            approvePairing: async () => ({
              attemptId: "attempt",
              machineName: "box",
            }),
            completePairing: async () => {
              throw Error("simulated failure");
            },
            abortPairing: async () => actions.push("abort"),
          }
        : {
            registerAgent: async () => ({
              agentId: "new-agent",
              agentToken: "test",
              grantKey: "test",
            }),
            revokeAgent: async (owner, id) => {
              assert.equal(owner, "owner");
              assert.equal(id, "new-agent");
              actions.push("revoke");
            },
          },
  };
  const response = await approve.POST({
    request: new Request("https://webssh.example/api/pairing/approve", {
      method: "POST",
      body: JSON.stringify({ code: "ABCDEFGH" }),
    }),
    locals: { user: { ownerId: "owner" } },
    platform: { env: { WEBSSH_STATE: namespace } },
  });
  assert.equal(response.status, 400);
  assert.deepEqual(actions, ["revoke", "abort"]);
  assert.equal((await response.json()).error, "request_failed");
});

test("session resolution authenticates owner and keeps descriptors out of error diagnostics", async () => {
  let crash = false;
  const namespace = {
    idFromName: (name) => {
      assert.equal(name, "owner:42");
      return name;
    },
    get: () => ({
      getTerminalSession: async (owner, id) => {
        assert.equal(owner, "42");
        assert.equal(id, "opaque");
        return { terminalSessionId: id };
      },
      resolveSession: async (owner, id, browser) => {
        assert.equal(owner, "42");
        assert.equal(id, "opaque");
        assert.equal(browser, "browser");
        if (crash) throw Error("secret_token_private_address");
        return { address: "tcPrivateAddress", port: 2222, grant: "v1.secret" };
      },
    }),
  };
  const event = {
    locals: { user: { ownerId: "42", sessionId: "browser" } },
    params: { session_id: "opaque" },
    platform: { env: { WEBSSH_STATE: namespace } },
  };
  const response = await grant.POST(event);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).grant, "v1.secret");
  crash = true;
  const failure = await grant.POST(event);
  assert.equal(failure.status, 503);
  assert.deepEqual(await failure.json(), { error: "session_unavailable" });
  event.locals.user = null;
  assert.equal((await grant.POST(event)).status, 401);
});

test("session resolver returns a fixed quota error without backend diagnostics", async () => {
  const namespace = {
    idFromName: (name) => name,
    get: () => ({
      getTerminalSession: async () => ({ terminalSessionId: "opaque" }),
      resolveSession: async () => {
        throw Error("resource_limit");
      },
    }),
  };
  const response = await grant.POST({
    locals: { user: { ownerId: "42", sessionId: "browser" } },
    params: { session_id: "opaque" },
    platform: { env: { WEBSSH_STATE: namespace } },
  });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { error: "resource_limit" });
});

test("machine revocation derives the owner from the session, never posted identity", async () => {
  const root = await moduleAt("src/routes/machines/+page.server.ts");
  let called = false;
  const namespace = {
    idFromName: (name) => {
      assert.equal(name, "owner:42");
      return name;
    },
    get: () => ({
      revokeAgent: async (owner, id) => {
        called = true;
        assert.equal(owner, "42");
        assert.equal(id, "agent-123456789012");
        return true;
      },
    }),
  };
  const response = await root.actions.revoke({
    locals: { user: { ownerId: "42", sessionId: "browser" } },
    platform: { env: { WEBSSH_STATE: namespace } },
    request: new Request("https://webssh.example/?/revoke", {
      method: "POST",
      body: new URLSearchParams({
        agentId: "agent-123456789012",
        ownerId: "different-owner",
      }),
    }),
  });
  assert(called);
  assert.match(response.message, /Access revoked/);
});

test("legacy localhost development login cookies are never authenticated", async () => {
  for (const origin of ["http://localhost:5173", "https://ssh.amarjay.com"]) {
    const event = {
      locals: {},
      url: new URL(origin),
      platform: undefined,
      cookies: { get: () => "1" },
      request: new Request(origin, { headers: { cookie: "webssh_dev=1" } }),
    };
    await hook.handle({ event, resolve: async () => new Response("ok") });
    assert.equal(event.locals.user, null);
  }
});

const machinePage = await moduleAt(
  "src/routes/machines/[machine_id]/+page.server.ts",
);
const machineA = "machine_aaaaaaaaaa",
  machineB = "machine_bbbbbbbbbb";
const runA = "run_aaaaaaaaaaaaaa",
  runB = "run_bbbbbbbbbbbbbb";
const sessionA = "session_aaaaaaaaaa",
  sessionB = "session_bbbbbbbbbb";
function machineEvent(state, fields = {}) {
  const ownerId = "42";
  const namespace = {
    idFromName: (name) => {
      assert.equal(name, "owner:42");
      return name;
    },
    get: () => state,
  };
  return {
    locals: { user: { ownerId, sessionId: "browser" } },
    params: { machine_id: machineA },
    platform: { env: { WEBSSH_STATE: namespace } },
    setHeaders: () => {},
    request: new Request("https://webssh.example/machines/" + machineA, {
      method: "POST",
      body: new URLSearchParams(fields),
    }),
  };
}
test("machine page only returns the selected owned machine and its sessions", async () => {
  const state = {
    listAgents: async (owner) => {
      assert.equal(owner, "42");
      return [{ agentId: machineA }, { agentId: machineB }];
    },
    listRuns: async () => [
      { agentId: machineA, runId: runA, status: "online" },
      { agentId: machineB, runId: runB, status: "online" },
    ],
    listTerminalSessions: async () => [
      { agentId: machineA, terminalSessionId: sessionA },
      { agentId: machineB, terminalSessionId: sessionB },
    ],
  };
  const event = machineEvent(state);
  const result = await machinePage.load(event);
  assert.equal(result.agent.agentId, machineA);
  assert.deepEqual(
    result.runs.map((run) => run.runId),
    [runA],
  );
  assert.deepEqual(
    result.sessions.map((session) => session.terminalSessionId),
    [sessionA],
  );
  await assert.rejects(
    () => machinePage.load({ ...event, params: { machine_id: "unknown" } }),
    (cause) => cause.status === 404,
  );
  await assert.rejects(
    () => machinePage.load({ ...event, locals: { user: null } }),
    (cause) => cause.status === 303 && cause.location.includes("/login?next="),
  );
});
test("machine actions reject runs and sessions from a different machine", async () => {
  let started = 0,
    ended = 0;
  const state = {
    listRuns: async (owner) => {
      assert.equal(owner, "42");
      return [
        { runId: runA, agentId: machineA },
        { runId: runB, agentId: machineB },
      ];
    },
    startRunSession: async (owner, run) => {
      assert.equal(owner, "42");
      assert.equal(run, runA);
      started++;
      return { terminalSessionId: sessionA };
    },
    getTerminalSession: async (owner, id) => {
      assert.equal(owner, "42");
      return { agentId: id === sessionA ? machineA : machineB };
    },
    endTerminalSession: async (owner, id) => {
      assert.equal(owner, "42");
      assert.equal(id, sessionA);
      ended++;
      return true;
    },
  };
  assert.equal(
    (await machinePage.actions.start(machineEvent(state, { runId: runB })))
      .status,
    404,
  );
  assert.equal(
    (
      await machinePage.actions.end(
        machineEvent(state, { sessionId: sessionB }),
      )
    ).status,
    404,
  );
  assert.equal(started, 0);
  assert.equal(ended, 0);
  await assert.rejects(
    () =>
      machinePage.actions.start(
        machineEvent(state, { runId: runA, ownerId: "forged" }),
      ),
    (cause) => cause.status === 303 && cause.location === "/s/" + sessionA,
  );
  assert.match(
    (
      await machinePage.actions.end(
        machineEvent(state, { sessionId: sessionA, ownerId: "forged" }),
      )
    ).message,
    /Termination requested/,
  );
  assert.equal(started, 1);
  assert.equal(ended, 1);
});

test("HTML responses preserve the origin of native same-site POST forms", async () => {
  const event = {
    locals: {},
    url: new URL("https://webssh.example/help"),
    request: new Request("https://webssh.example/help"),
  };
  const response = await hook.handle({
    event,
    resolve: async () =>
      new Response('<form method="POST" action="/logout"></form>'),
  });
  assert.equal(response.headers.get("referrer-policy"), "same-origin");
  const headers = await import("node:fs/promises").then((fs) =>
    fs.readFile(resolve("_headers"), "utf8"),
  );
  assert.match(headers, /Referrer-Policy: same-origin/);
  assert.doesNotMatch(headers, /Referrer-Policy: no-referrer/);
});

test("logout revokes the signed-in browser session and clears its cookie", async () => {
  const logout = await moduleAt("src/routes/logout/+server.ts");
  let revoked = false;
  const namespace = {
    idFromName: (name) => {
      assert.equal(name, "owner:42");
      return name;
    },
    get: () => ({
      revokeBrowserSession: async (id) => {
        assert.equal(id, "browser");
        revoked = true;
      },
    }),
  };
  const response = await logout.POST({
    locals: { user: { ownerId: "42", sessionId: "browser" } },
    platform: { env: { ...env, WEBSSH_STATE: namespace } },
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/");
  assert.match(
    response.headers.get("set-cookie"),
    /__Host-webssh_session=;.*Max-Age=0/,
  );
  assert.equal(revoked, true);
});

test("native CLI approval checks ownership and binds access to the authenticated browser", async () => {
  const approval = await moduleAt("src/routes/attach/+page.server.ts");
  let approved = 0,
    foreign = false;
  const ns = {
    idFromName: (name) => name,
    get: (name) =>
      name === "pairing"
        ? {
            previewCLIAttach: async () => ({
              sessionId: "session_123456789012",
            }),
            approveCLIAttach: async (code, owner, browser) => {
              assert.equal(code, "ABCDEFGH");
              assert.equal(owner, "42");
              assert.equal(browser, "browser");
              approved++;
            },
          }
        : {
            getTerminalSession: async (owner, id) => {
              assert.equal(name, "owner:42");
              assert.equal(owner, "42");
              assert.equal(id, "session_123456789012");
              return foreign
                ? null
                : { status: "connecting", workspaceLabel: "project" };
            },
          },
  };
  const event = () => ({
    locals: { user: { ownerId: "42", sessionId: "browser" } },
    platform: { env: { WEBSSH_STATE: ns } },
    request: new Request("https://webssh.example/attach", {
      method: "POST",
      body: new URLSearchParams({ code: "ABCDEFGH", ownerId: "forged" }),
    }),
  });
  const loaded = await approval.load({
    ...event(),
    url: new URL("https://webssh.example/attach?code=ABCDEFGH"),
    setHeaders: () => {},
  });
  assert.equal(loaded.workspace, "project");
  assert.equal(approved, 0);
  foreign = true;
  assert.equal((await approval.actions.default(event())).status, 409);
  assert.equal(approved, 0);
  foreign = false;
  assert.equal((await approval.actions.default(event())).approved, true);
  assert.equal(approved, 1);
  await assert.rejects(
    () => approval.actions.default({ ...event(), locals: { user: null } }),
    (error) => error.status === 303,
  );
});

test("CLI polling mints a fresh descriptor using only the approved identity and hides backend errors", async () => {
  const poll = await moduleAt("src/routes/api/cli/attach/poll/+server.ts");
  let fail = false;
  const ns = {
    idFromName: (name) => name,
    get: (name) =>
      name === "pairing"
        ? {
            limitRequest: async () => {},
            pollCLIAttach: async () => ({
              status: "approved",
              ownerId: "42",
              browserId: "browser",
              sessionId: "session_123456789012",
            }),
          }
        : {
            resolveSession: async (owner, id, browser) => {
              assert.equal(name, "owner:42");
              assert.equal(owner, "42");
              assert.equal(id, "session_123456789012");
              assert.equal(browser, "browser");
              if (fail) throw Error("private-token");
              return { grant: "v1.test", terminalSessionId: id };
            },
          },
  };
  const event = () => ({
    platform: { env: { WEBSSH_STATE: ns } },
    request: new Request("https://webssh.example/api/cli/attach/poll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: "ABCDEFGH",
        cliSecret: "S".repeat(32),
        ownerId: "forged",
      }),
    }),
  });
  const response = await poll.POST(event());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).status, "approved");
  fail = true;
  const failed = await poll.POST(event());
  assert.equal(failed.status, 409);
  assert.doesNotMatch(await failed.text(), /private-token/);
});

test("localhost login uses OAuth instead of a fabricated user", async () => {
  const login = await moduleAt("src/routes/login/+server.ts");
  const cookies = [];
  const response = await login.GET({
    url: new URL("http://localhost:5173/login"),
    platform: { env: { ...env, PUBLIC_ORIGIN: "http://localhost:5173" } },
    cookies: { set: (name, value) => cookies.push([name, value]) },
  });
  assert.equal(response.status, 303);
  assert.match(
    response.headers.get("location"),
    /^https:\/\/github.com\/login\/oauth\/authorize\?/,
  );
  assert.deepEqual(
    cookies.map(([name]) => name),
    ["webssh_oauth"],
  );
});
