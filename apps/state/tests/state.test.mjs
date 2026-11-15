import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
const source = await build({
  stdin: {
    contents: `import { WebSSHState as Base } from './src/index.ts';
export class WebSSHState extends Base { async sqlForTest(query,bindings=[]) { return [...this.ctx.storage.sql.exec(query,...bindings)]; } async ageEnd(id,age) { this.ctx.storage.sql.exec('UPDATE terminal_sessions SET ended_at = ? WHERE terminal_session_id = ?',Date.now()-age,id); await this.alarm(); } async testCall(method,args) { try { return {ok:true,value:await this[method](...args)}; } catch(e) { return {ok:false,error:e.message}; } } async ageRun(id,age) { this.ctx.storage.sql.exec('UPDATE agent_runs SET last_seen_at = ? WHERE run_id = ?',Date.now()-age,id); } async expire(code) { this.ctx.storage.sql.exec('UPDATE pairing_attempts SET expires_at = 0 WHERE code = ?',code); } }
export default { fetch(){ return new Response('test'); } };`,
    resolveDir: process.cwd(),
    sourcefile: "test-worker.ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  external: ["cloudflare:workers"],
  write: false,
});
test("SQLite DO: owner isolation, pairing races/expiry, single-use grants and revocation", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE");
    const owner = ns.get(ns.idFromName("owner:1")),
      other = ns.get(ns.idFromName("owner:2")),
      hub = ns.get(ns.idFromName("pairing"));
    await owner.ensureOwner("1", "alice");
    const browser = await owner.createBrowserSession("1");
    const attempt = await hub.startPairing("machine", "127.0.0.1");
    assert.equal(
      (await hub.previewPairing(attempt.code, "1")).machineName,
      "machine",
    );
    const claim = await hub.approvePairing(attempt.code, "1");
    await assert.rejects(hub.approvePairing(attempt.code, "2"));
    const agent = { ...(await owner.registerAgent("1", "machine")) };
    await hub.completePairing(claim.attemptId, "1", {
      ...agent,
      machineName: "machine",
    });
    const polls = await Promise.all([
      hub.pollPairing(attempt.code, attempt.cliSecret),
      hub.pollPairing(attempt.code, attempt.cliSecret),
    ]);
    assert.equal(polls.filter((p) => p.status === "completed").length, 1);
    const expired = await hub.startPairing("late", "127.0.0.1");
    const claimed = await hub.approvePairing(expired.code, "1");
    await hub.completePairing(claimed.attemptId, "1", {
      ...agent,
      machineName: "late",
    });
    await hub.expire(expired.code);
    assert.equal(
      (await hub.pollPairing(expired.code, expired.cliSecret)).status,
      "expired",
    );
    const oldToken = agent.agentToken;
    const replacementToken = "R".repeat(43);
    const rotationId = "O".repeat(43);
    await owner.agentCredential(
      "1",
      agent.agentId,
      oldToken,
      "renew",
      replacementToken,
      rotationId,
    );
    agent.agentToken = replacementToken;
    await assert.rejects(owner.agentSession("1", agent.agentId, oldToken));
    const run = await owner.agentSession("1", agent.agentId, agent.agentToken);
    assert.equal(await other.getTerminalSession("2", run.sessionId), null);
    await assert.rejects(
      other.agentSession("2", agent.agentId, agent.agentToken),
    );
    await assert.rejects(
      owner.mintGrant("2", run.sessionId, browser.sessionId),
    );
    const grant = await owner.mintGrant("1", run.sessionId, browser.sessionId);
    const nonce = grant.grant.split(".")[3];
    await owner.agentSession(
      "1",
      agent.agentId,
      agent.agentToken,
      run.sessionId,
      nonce,
    );
    await assert.rejects(
      owner.agentSession(
        "1",
        agent.agentId,
        agent.agentToken,
        run.sessionId,
        nonce,
      ),
    );
    await owner.revokeBrowserSession(browser.sessionId);
    await assert.rejects(
      owner.mintGrant("1", run.sessionId, browser.sessionId),
    );
    await assert.rejects(
      owner.agentSession(
        "1",
        agent.agentId,
        agent.agentToken,
        run.sessionId,
        "check:" + nonce,
      ),
    );
    await owner.revokeAgent("1", agent.agentId);
    await assert.rejects(
      owner.agentSession("1", agent.agentId, agent.agentToken),
    );
  } finally {
    await mf.dispose();
  }
});

async function rpcReject(stub, method, args, error) {
  const result = await stub.testCall(method, args);
  assert.equal(result.ok, false, method + " should reject");
  if (error) assert.match(result.error, error);
}

test("agent runs: authenticated announcement, owner-only resolution, lifecycle and lost-heartbeat semantics", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE");
    const owner = ns.get(ns.idFromName("owner:alice")),
      other = ns.get(ns.idFromName("owner:bob"));
    const agent = await owner.registerAgent("alice", "box");
    const browser = await owner.createBrowserSession("alice");
    const runId = "run_1234567890123456";
    const update = (operation, fields = {}) =>
      owner.agentRun("alice", agent.agentId, agent.agentToken, {
        operation,
        runId,
        ...fields,
      });
    await assert.rejects(
      owner.agentRun("alice", agent.agentId, "wrong", {
        operation: "start",
        runId,
        machineName: "box",
        workspaceLabel: "project",
      }),
    );
    await update("start", {
      machineName: "configured-name",
      workspaceLabel: "project",
    });
    await update("start", {
      machineName: "configured-name",
      workspaceLabel: "project",
    });
    assert.equal((await owner.listTerminalSessions("alice")).length, 1);
    await rpcReject(
      owner,
      "resolveSession",
      ["alice", runId, browser.sessionId],
      /agent_offline/,
    );
    await update("announce", { address: "tcTestAddress123456789", port: 2222 });
    const publicData = JSON.stringify({
      runs: await owner.listRuns("alice"),
      sessions: await owner.listTerminalSessions("alice"),
      agents: await owner.listAgents("alice"),
    });
    for (const secret of [
      agent.agentToken,
      agent.grantKey,
      "tcTestAddress123456789",
    ])
      assert.ok(!publicData.includes(secret));
    assert.equal(
      (await owner.listRuns("alice"))[0].machineName,
      "configured-name",
    );
    assert.equal(
      (await owner.getTerminalSession("alice", runId)).status,
      "connecting",
    );
    await rpcReject(
      other,
      "resolveSession",
      ["bob", runId, browser.sessionId],
      /not_found/,
    );
    await assert.rejects(other.startRunSession("bob", runId));
    assert.equal(await other.endTerminalSession("bob", runId), false);
    const connection = await owner.resolveSession(
      "alice",
      runId,
      browser.sessionId,
    );
    assert.equal(connection.address, "tcTestAddress123456789");
    assert.equal(connection.port, 2222);
    const nonce = connection.grant.split(".")[3];
    await assert.rejects(
      owner.agentSession(
        "alice",
        agent.agentId,
        agent.agentToken,
        runId,
        nonce,
        "different_run",
      ),
    );
    await owner.agentSession(
      "alice",
      agent.agentId,
      agent.agentToken,
      runId,
      nonce,
      runId,
    );
    assert.equal(
      (await owner.getTerminalSession("alice", runId)).status,
      "active",
    );
    await rpcReject(
      owner,
      "resolveSession",
      ["alice", runId, browser.sessionId],
      /session_busy/,
    );
    await owner.ageRun(runId, 40_000);
    const offline = await owner.getTerminalSession("alice", runId);
    assert.equal(offline.status, "offline");
    assert.equal(offline.endedAt, null);
    assert.equal((await owner.listRuns("alice"))[0].status, "offline");
    await rpcReject(
      owner,
      "resolveSession",
      ["alice", runId, browser.sessionId],
      /agent_offline/,
    );
    await update("heartbeat");
    await owner.agentSession(
      "alice",
      agent.agentId,
      agent.agentToken,
      runId,
      "release:" + nonce,
      runId,
    );
    assert.equal(
      (await owner.getTerminalSession("alice", runId)).status,
      "ended",
    );
    await rpcReject(
      owner,
      "resolveSession",
      ["alice", runId, browser.sessionId],
      /session_ended/,
    );
    const starts = await Promise.all([
      owner.startRunSession("alice", runId),
      owner.startRunSession("alice", runId),
    ]);
    assert.equal(starts[0].terminalSessionId, starts[1].terminalSessionId);
    assert.notEqual(starts[0].terminalSessionId, runId);
    const next = starts[0].terminalSessionId;
    const nextGrant = await owner.resolveSession(
      "alice",
      next,
      browser.sessionId,
    );
    const nextNonce = nextGrant.grant.split(".")[3];
    await owner.agentSession(
      "alice",
      agent.agentId,
      agent.agentToken,
      next,
      nextNonce,
      runId,
    );
    await owner.endTerminalSession("alice", next);
    await assert.rejects(
      owner.agentSession(
        "alice",
        agent.agentId,
        agent.agentToken,
        next,
        "check:" + nextNonce,
        runId,
      ),
    );
    const expired = await owner.startRunSession("alice", runId);
    await owner.ageRun(runId, 86_400_001);
    const expiredRow = await owner.getTerminalSession(
      "alice",
      expired.terminalSessionId,
    );
    assert.equal(expiredRow.status, "expired");
    assert.equal(expiredRow.endedAt, null);
    await assert.rejects(update("heartbeat"));
    await rpcReject(
      owner,
      "resolveSession",
      ["alice", expired.terminalSessionId, browser.sessionId],
      /session_expired/,
    );
    const failedRun = "failed_1234567890123456";
    await owner.agentRun("alice", agent.agentId, agent.agentToken, {
      operation: "start",
      runId: failedRun,
      machineName: "box",
      workspaceLabel: "project",
    });
    await owner.agentRun("alice", agent.agentId, agent.agentToken, {
      operation: "end",
      runId: failedRun,
    });
    assert.equal(
      (await owner.getTerminalSession("alice", failedRun)).status,
      "ended",
    );
  } finally {
    await mf.dispose();
  }
});

test("durable sessions detach, fence stale grants on restart, and reconcile explicit termination", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE");
    const owner = ns.get(ns.idFromName("owner:durable"));
    const agent = await owner.registerAgent("durable", "box");
    const browser = await owner.createBrowserSession("durable");
    const runId = "durable_run_123456789";
    let generation = "generation_1234567890";
    const update = (operation, rest = {}) =>
      owner.agentRun("durable", agent.agentId, agent.agentToken, {
        operation,
        runId,
        backend: "tmux",
        generation,
        ...rest,
      });
    await update("start", { machineName: "box", workspaceLabel: "project" });
    await update("announce", {
      address: "tcPersistentAddress1234",
      port: 2222,
    });
    const first = await owner.resolveSession(
      "durable",
      runId,
      browser.sessionId,
    );
    let nonce = first.grant.split(".")[3];
    assert.equal(first.backend, "tmux");
    await owner.agentSession(
      "durable",
      agent.agentId,
      agent.agentToken,
      runId,
      nonce,
      runId,
      generation,
    );
    await owner.agentSession(
      "durable",
      agent.agentId,
      agent.agentToken,
      runId,
      "detach:" + nonce,
      runId,
      generation,
    );
    let row = await owner.getTerminalSession("durable", runId);
    assert.equal(row.status, "connecting");
    assert.equal(row.endedAt, null);
    const stale = await owner.resolveSession(
      "durable",
      runId,
      browser.sessionId,
    );
    nonce = stale.grant.split(".")[3];
    const previous = generation;
    generation = "generation_ABCDEFGHIJ";
    const restarted = await update("start", {
      machineName: "box",
      workspaceLabel: "project",
      recoveredIds: [runId],
    });
    assert.equal(restarted.sessionId, runId);
    await update("announce", {
      address: "tcNewPersistentAddress1234",
      port: 2222,
    });
    await rpcReject(
      owner,
      "agentSession",
      [
        "durable",
        agent.agentId,
        agent.agentToken,
        runId,
        nonce,
        runId,
        generation,
      ],
      /unauthorized/,
    );
    await rpcReject(
      owner,
      "agentRun",
      [
        "durable",
        agent.agentId,
        agent.agentToken,
        {
          operation: "heartbeat",
          runId,
          backend: "tmux",
          generation: previous,
        },
      ],
      /unauthorized/,
    );
    const current = await owner.resolveSession(
      "durable",
      runId,
      browser.sessionId,
    );
    nonce = current.grant.split(".")[3];
    await owner.agentSession(
      "durable",
      agent.agentId,
      agent.agentToken,
      runId,
      nonce,
      runId,
      generation,
    );
    await update("offline");
    row = await owner.getTerminalSession("durable", runId);
    assert.equal(row.status, "offline");
    assert.equal(row.endedAt, null);
    assert.equal(await owner.endTerminalSession("durable", runId), true);
    await owner.ageEnd(runId, 8 * 86400000);
    row = await owner.getTerminalSession("durable", runId);
    assert.equal(row.terminationRequested, true);
    generation = "generation_KLMNOPQRST";
    const recovery = await update("start", {
      machineName: "box",
      workspaceLabel: "project",
      recoveredIds: [runId],
    });
    assert(recovery.terminateIds.includes(runId));
    assert.notEqual(recovery.sessionId, runId);
    await rpcReject(
      owner,
      "resolveSession",
      ["durable", runId, browser.sessionId],
      /session_ended/,
    );
    await update("announce", {
      address: "tcLastPersistentAddress1234",
      port: 2222,
      terminatedIds: [runId],
    });
    assert.equal(
      (await owner.getTerminalSession("durable", runId)).terminationRequested,
      false,
    );
    const next = recovery.sessionId;
    const nextConnection = await owner.resolveSession(
      "durable",
      next,
      browser.sessionId,
    );
    const nextNonce = nextConnection.grant.split(".")[3];
    await owner.agentSession(
      "durable",
      agent.agentId,
      agent.agentToken,
      next,
      nextNonce,
      runId,
      generation,
    );
    await owner.revokeAgent("durable", agent.agentId);
    await rpcReject(
      owner,
      "agentSession",
      [
        "durable",
        agent.agentId,
        agent.agentToken,
        next,
        "check:" + nextNonce,
        runId,
        generation,
      ],
      /unauthorized/,
    );
  } finally {
    await mf.dispose();
  }
});

test("exact grant/browser expiry and revocation invalidate admission and active leases", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE"),
      owner = ns.get(ns.idFromName("owner:expiry"));
    const agent = await owner.registerAgent("expiry", "box"),
      browser = await owner.createBrowserSession("expiry");
    const runId = "expiry_run_123456789";
    await owner.agentRun("expiry", agent.agentId, agent.agentToken, {
      operation: "start",
      runId,
      machineName: "box",
      workspaceLabel: "work",
    });
    await owner.agentRun("expiry", agent.agentId, agent.agentToken, {
      operation: "announce",
      runId,
      address: "tcExpiryAddress123456",
      port: 2222,
    });
    let issued = await owner.resolveSession("expiry", runId, browser.sessionId),
      nonce = issued.grant.split(".")[3];
    await owner.sqlForTest(
      "UPDATE grant_nonces SET exp_unix = ? WHERE nonce = ?",
      [Math.floor(Date.now() / 1000), nonce],
    );
    await rpcReject(
      owner,
      "agentSession",
      ["expiry", agent.agentId, agent.agentToken, runId, nonce, runId],
      /unauthorized/,
    );
    issued = await owner.resolveSession("expiry", runId, browser.sessionId);
    nonce = issued.grant.split(".")[3];
    await owner.agentSession(
      "expiry",
      agent.agentId,
      agent.agentToken,
      runId,
      nonce,
      runId,
    );
    await owner.sqlForTest(
      "UPDATE grant_nonces SET exp_unix = 0 WHERE nonce = ?",
      [nonce],
    );
    // Grant TTL is an attach deadline, not a shell lifetime. Current browser/agent/lease remain mandatory.
    await owner.agentSession(
      "expiry",
      agent.agentId,
      agent.agentToken,
      runId,
      "check:" + nonce,
      runId,
    );
    await owner.sqlForTest(
      "UPDATE browser_sessions SET expires_at = ? WHERE session_id = ?",
      [Date.now(), browser.sessionId],
    );
    await rpcReject(
      owner,
      "agentSession",
      [
        "expiry",
        agent.agentId,
        agent.agentToken,
        runId,
        "check:" + nonce,
        runId,
      ],
      /unauthorized/,
    );
    await rpcReject(owner, "resolveSession", [
      "expiry",
      runId,
      browser.sessionId,
    ]);
    const other = await owner.createBrowserSession("expiry");
    await owner.sqlForTest(
      "UPDATE terminal_sessions SET active_nonce = NULL,lease_expires_at = NULL WHERE terminal_session_id = ?",
      [runId],
    );
    issued = await owner.resolveSession("expiry", runId, other.sessionId);
    nonce = issued.grant.split(".")[3];
    await owner.agentSession(
      "expiry",
      agent.agentId,
      agent.agentToken,
      runId,
      nonce,
      runId,
    );
    await owner.revokeBrowserSession(other.sessionId);
    await rpcReject(
      owner,
      "agentSession",
      [
        "expiry",
        agent.agentId,
        agent.agentToken,
        runId,
        "check:" + nonce,
        runId,
      ],
      /unauthorized/,
    );
    assert.equal(
      (
        await owner.sqlForTest(
          "SELECT COUNT(*) n FROM grant_nonces WHERE browser_session_id = ?",
          [other.sessionId],
        )
      )[0].n,
      0,
    );
    assert.equal(
      (await owner.getTerminalSession("expiry", runId)).endedAt,
      null,
    );
  } finally {
    await mf.dispose();
  }
});

test("concurrent grants and metadata creation obey hard storage quotas without evicting tombstones", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE"),
      owner = ns.get(ns.idFromName("owner:quota"));
    const agent = await owner.registerAgent("quota", "box"),
      browser = await owner.createBrowserSession("quota"),
      runId = "quota_run_1234567890";
    await owner.agentRun("quota", agent.agentId, agent.agentToken, {
      operation: "start",
      runId,
      machineName: "box",
      workspaceLabel: "work",
    });
    await owner.agentRun("quota", agent.agentId, agent.agentToken, {
      operation: "announce",
      runId,
      address: "tcQuotaAddress1234567",
      port: 2222,
    });
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        owner.testCall("resolveSession", ["quota", runId, browser.sessionId]),
      ),
    );
    assert.equal(results.filter((r) => r.ok).length, 16);
    assert(
      results.filter((r) => !r.ok).every((r) => r.error === "resource_limit"),
    );
    const nonce = results.find((r) => r.ok).value.grant.split(".")[3];
    await owner.agentSession(
      "quota",
      agent.agentId,
      agent.agentToken,
      runId,
      nonce,
      runId,
    );
    await owner.sqlForTest("UPDATE grant_nonces SET exp_unix = 0");
    // Pruning frees unused grants but keeps the expired nonce backing an active lease.
    await owner.mintGrant("quota", runId, browser.sessionId);
    assert.equal(
      (await owner.sqlForTest("SELECT COUNT(*) n FROM grant_nonces"))[0].n,
      2,
    );
    await owner.agentSession(
      "quota",
      agent.agentId,
      agent.agentToken,
      runId,
      "check:" + nonce,
      runId,
    );
    await owner.endTerminalSession("quota", runId);
    await owner.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<127)
    INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,run_id,status,created_at,ended_at) SELECT 'quota-session-'||x,'quota',?,?,'ended',?,? FROM n`,
      [agent.agentId, runId, Date.now(), Date.now()],
    );
    await rpcReject(
      owner,
      "startRunSession",
      ["quota", runId],
      /resource_limit/,
    );
    assert.equal(
      (
        await owner.sqlForTest(
          "SELECT COUNT(*) n FROM terminal_sessions WHERE run_id = ?",
          [runId],
        )
      )[0].n,
      128,
    );
    await owner.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<31)
    INSERT INTO agent_runs (run_id,owner_id,agent_id,machine_name,workspace_label,status,created_at,last_seen_at) SELECT 'quota-run-'||x,'quota',?,'box','work','offline',?,? FROM n`,
      [agent.agentId, Date.now(), Date.now()],
    );
    await rpcReject(
      owner,
      "agentRun",
      [
        "quota",
        agent.agentId,
        agent.agentToken,
        {
          operation: "start",
          runId: "another_run_123456789",
          machineName: "box",
          workspaceLabel: "work",
        },
      ],
      /resource_limit/,
    );
    assert.equal(
      (await owner.sqlForTest("SELECT COUNT(*) n FROM agent_runs"))[0].n,
      32,
    );
    await owner.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<127)
    INSERT INTO agents (agent_id,owner_id,machine_name,token_hash,grant_key,created_at,token_expires_at) SELECT 'quota-agent-'||x,'quota','box','hash','key',?,? FROM n`,
      [Date.now(), Date.now() + 86400000],
    );
    await rpcReject(
      owner,
      "registerAgent",
      ["quota", "overflow"],
      /resource_limit/,
    );
    const count = (
      await owner.sqlForTest("SELECT COUNT(*) n FROM terminal_sessions")
    )[0].n;
    await owner.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<?)
    INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,status,created_at) SELECT 'owner-session-'||x,'quota',?,'ended',? FROM n`,
      [4096 - count, agent.agentId, Date.now()],
    );
    await rpcReject(
      owner,
      "agentSession",
      ["quota", agent.agentId, agent.agentToken],
      /resource_limit/,
    );
    assert.equal(
      (await owner.sqlForTest("SELECT COUNT(*) n FROM terminal_sessions"))[0].n,
      4096,
    );
    await owner.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<63)
    INSERT INTO browser_sessions (session_id,owner_id,expires_at,created_at) SELECT 'quota-browser-'||x,'quota',?,? FROM n`,
      [Date.now() + 86400000, Date.now()],
    );
    await rpcReject(owner, "createBrowserSession", ["quota"], /resource_limit/);
    await owner.sqlForTest(
      "UPDATE browser_sessions SET expires_at = 0 WHERE session_id = ?",
      [browser.sessionId],
    );
    await owner.createBrowserSession("quota");
    assert.equal(
      (await owner.sqlForTest("SELECT COUNT(*) n FROM browser_sessions"))[0].n,
      64,
    );
  } finally {
    await mf.dispose();
  }
});

test("shared pairing hub storage remains bounded across new IPs and attempts", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE"),
      hub = ns.get(ns.idFromName("pairing"));
    await hub.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4096)
    INSERT INTO pairing_rate (bucket,count,window_start) SELECT 'bucket-'||x,1,? FROM n`,
      [Date.now()],
    );
    await rpcReject(
      hub,
      "limitRequest",
      ["127.0.0.1", "poll"],
      /resource_limit/,
    );
    assert.equal(
      (await hub.sqlForTest("SELECT COUNT(*) n FROM pairing_rate"))[0].n,
      4096,
    );
    await hub.sqlForTest("UPDATE pairing_rate SET window_start = 0");
    await hub.limitRequest("127.0.0.1", "poll");
    assert.equal(
      (await hub.sqlForTest("SELECT COUNT(*) n FROM pairing_rate"))[0].n,
      2,
    );
    await hub.sqlForTest(
      `WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<512)
    INSERT INTO pairing_attempts (attempt_id,code,code_hash,cli_secret_hash,machine_name,client_ip,status,created_at,expires_at) SELECT 'attempt-'||x,'code-'||x,'hash','hash','box','ip','pending',?,? FROM n`,
      [Date.now(), Date.now() + 600000],
    );
    await rpcReject(
      hub,
      "startPairing",
      ["box", "127.0.0.1"],
      /resource_limit/,
    );
    assert.equal(
      (await hub.sqlForTest("SELECT COUNT(*) n FROM pairing_attempts"))[0].n,
      512,
    );
  } finally {
    await mf.dispose();
  }
});

test("native CLI approvals are expiring, secret-protected and consumed once under concurrent polls", async () => {
  const mf = new Miniflare({
    modules: true,
    script: source.outputFiles[0].text,
    compatibilityDate: "2026-08-06",
    durableObjects: { STATE: { className: "WebSSHState", useSQLite: true } },
  });
  try {
    const ns = await mf.getDurableObjectNamespace("STATE"),
      hub = ns.get(ns.idFromName("pairing"));
    const attempt = await hub.startCLIAttach(
      "session_123456789012",
      "127.0.0.1",
    );
    assert.equal(
      (await hub.previewCLIAttach(attempt.code)).sessionId,
      "session_123456789012",
    );
    assert.equal(
      (await hub.pollCLIAttach(attempt.code, attempt.cliSecret)).status,
      "pending",
    );
    await assert.rejects(hub.pollCLIAttach(attempt.code, "wrong-secret"));
    await hub.approveCLIAttach(attempt.code, "owner", "browser");
    await assert.rejects(
      hub.approveCLIAttach(attempt.code, "foreign", "foreign-browser"),
    );
    const results = await Promise.all([
      hub.pollCLIAttach(attempt.code, attempt.cliSecret),
      hub.pollCLIAttach(attempt.code, attempt.cliSecret),
    ]);
    const approval = results.find((result) => result.status === "approved");
    assert.equal(approval.sessionId, "session_123456789012");
    assert.equal(approval.ownerId, "owner");
    assert.equal(approval.browserId, "browser");
    assert.equal(
      results.filter((result) => result.status === "approved").length,
      1,
    );
    assert.equal(
      (await hub.pollCLIAttach(attempt.code, attempt.cliSecret)).status,
      "expired",
    );
    const expired = await hub.startCLIAttach(
      "session_123456789012",
      "127.0.0.1",
    );
    await hub.sqlForTest(
      "UPDATE cli_attach_attempts SET expires_at=0 WHERE code=?",
      [expired.code],
    );
    await assert.rejects(
      hub.approveCLIAttach(expired.code, "owner", "browser"),
    );
    assert.equal(
      (await hub.pollCLIAttach(expired.code, expired.cliSecret)).status,
      "expired",
    );
    assert.equal((await hub.testCall("alarm", [])).ok, true);
    assert.equal(
      (
        await hub.sqlForTest("SELECT * FROM cli_attach_attempts WHERE code=?", [
          expired.code,
        ])
      ).length,
      0,
    );
  } finally {
    await mf.dispose();
  }
});
