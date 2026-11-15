import { DurableObject } from "cloudflare:workers";
import {
  encodeGrant,
  randomCode,
  randomId,
  sha256,
  timingSafeEqual,
} from "./crypto.js";
import { limits } from "./limits.js";
import { applyMigrations } from "./schema.js";
import type {
  AgentRecord,
  RunRecord,
  RunUpdate,
  ResolvedSession,
  GrantMintResult,
  OwnerRecord,
  PairingPollResult,
  PairingStartResult,
  TerminalSessionRecord,
} from "./types.js";

export interface Env {
  WEBSSH_STATE: DurableObjectNamespace<WebSSHState>;
}

const PAIRING_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const GRANT_TTL_SEC = 60;
const RUN_OFFLINE_MS = 35_000;
const RUN_EXPIRE_MS = 24 * 60 * 60 * 1000;
const PAIRING_IP_LIMIT = 10;
const PAIRING_GLOBAL_LIMIT = 200;
const PAIRING_WINDOW_MS = 60 * 60 * 1000;

export function ownerObjectId(
  ns: DurableObjectNamespace<WebSSHState>,
  ownerId: string,
) {
  return ns.idFromName(`owner:${ownerId}`);
}

export function pairingObjectId(ns: DurableObjectNamespace<WebSSHState>) {
  return ns.idFromName("pairing");
}

export class WebSSHState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      applyMigrations(this.ctx.storage.sql, (fn) =>
        this.ctx.storage.transactionSync(fn),
      );
    });
  }

  private capacity(
    table:
      | "agents"
      | "agent_runs"
      | "terminal_sessions"
      | "browser_sessions"
      | "grant_nonces"
      | "pairing_attempts"
      | "pairing_rate",
    limit: number,
    where = "",
    ...bindings: (string | number)[]
  ) {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT COUNT(*) AS n FROM ${table}${where ? " WHERE " + where : ""}`,
        ...bindings,
      )
      .next().value;
    if (Number(row?.n) >= limit) throw new Error("resource_limit");
  }

  private sessionCapacity(ownerId: string, runId?: string) {
    this.capacity(
      "terminal_sessions",
      limits.sessions,
      "owner_id = ?",
      ownerId,
    );
    if (runId)
      this.capacity(
        "terminal_sessions",
        limits.sessionsPerRun,
        "run_id = ? AND owner_id = ?",
        runId,
        ownerId,
      );
  }

  private pruneGrants() {
    this.ctx.storage.sql.exec(
      `DELETE FROM grant_nonces WHERE exp_unix <= ? AND nonce NOT IN (SELECT active_nonce FROM terminal_sessions WHERE active_nonce IS NOT NULL AND lease_expires_at > ?)`,
      Math.floor(Date.now() / 1000),
      Date.now(),
    );
  }

  // --- Owner profile & browser sessions ---

  async ensureOwner(
    ownerId: string,
    githubLogin: string,
  ): Promise<OwnerRecord> {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO owners (owner_id, github_login, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(owner_id) DO UPDATE SET github_login = excluded.github_login`,
      ownerId,
      githubLogin,
      now,
    );
    return { ownerId, githubLogin, createdAt: now };
  }

  async createBrowserSession(
    ownerId: string,
  ): Promise<{ sessionId: string; expiresAt: number }> {
    const sessionId = await randomId(24);
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `DELETE FROM browser_sessions WHERE owner_id = ? AND (expires_at <= ? OR revoked_at IS NOT NULL)`,
        ownerId,
        now,
      );
      this.capacity(
        "browser_sessions",
        limits.browsers,
        "owner_id = ?",
        ownerId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO browser_sessions (session_id, owner_id, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, NULL)`,
        sessionId,
        ownerId,
        expiresAt,
        now,
      );
    });
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return { sessionId, expiresAt };
  }

  async getBrowserSession(
    sessionId: string,
  ): Promise<{ ownerId: string; expiresAt: number } | null> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT owner_id, expires_at, revoked_at FROM browser_sessions WHERE session_id = ?`,
        sessionId,
      )
      .next().value as
      | { owner_id: string; expires_at: number; revoked_at: number | null }
      | undefined;
    if (!row || row.revoked_at != null || row.expires_at <= Date.now())
      return null;
    return { ownerId: row.owner_id, expiresAt: row.expires_at };
  }

  async revokeBrowserSession(sessionId: string): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE browser_sessions SET revoked_at = ? WHERE session_id = ? AND revoked_at IS NULL`,
        Date.now(),
        sessionId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sessions SET active_nonce = NULL, lease_expires_at = NULL WHERE active_nonce IN (SELECT nonce FROM grant_nonces WHERE browser_session_id = ?)`,
        sessionId,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM grant_nonces WHERE browser_session_id = ?`,
        sessionId,
      );
    });
  }

  // --- Agents ---

  async listAgents(ownerId: string): Promise<AgentRecord[]> {
    const rows = this.ctx.storage.sql.exec(
      `SELECT agent_id, owner_id, machine_name, revoked_at, created_at, last_seen_at
       FROM agents WHERE owner_id = ? ORDER BY created_at DESC`,
      ownerId,
    );
    return [...rows].map((row) => ({
      agentId: String(row.agent_id),
      ownerId: String(row.owner_id),
      machineName: String(row.machine_name),
      revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
      createdAt: Number(row.created_at),
      lastSeenAt: row.last_seen_at == null ? null : Number(row.last_seen_at),
    }));
  }

  async registerAgent(
    ownerId: string,
    machineName: string,
  ): Promise<{ agentId: string; agentToken: string; grantKey: string }> {
    const agentId = await randomId(16);
    const agentToken = await randomId(32);
    const grantKey = await randomId(32);
    const tokenHash = await sha256(agentToken);
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.capacity("agents", limits.agents, "owner_id = ?", ownerId);
      this.ctx.storage.sql.exec(
        `INSERT INTO agents (agent_id, owner_id, machine_name, token_hash, grant_key, revoked_at, created_at, last_seen_at, token_expires_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
        agentId,
        ownerId,
        machineName,
        tokenHash,
        grantKey,
        now,
        now + 30 * 24 * 60 * 60 * 1000,
      );
    });
    return { agentId, agentToken, grantKey };
  }

  async revokeAgent(ownerId: string, agentId: string): Promise<boolean> {
    return this.ctx.storage.transactionSync(() => {
      const result = this.ctx.storage.sql.exec(
        `UPDATE agents SET revoked_at = ? WHERE agent_id = ? AND owner_id = ? AND revoked_at IS NULL`,
        Date.now(),
        agentId,
        ownerId,
      );
      if (!result.rowsWritten) return false;
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sessions SET active_nonce = NULL, lease_expires_at = NULL WHERE agent_id = ? AND owner_id = ?`,
        agentId,
        ownerId,
      );
      this.ctx.storage.sql.exec(
        `DELETE FROM grant_nonces WHERE agent_id = ?`,
        agentId,
      );
      this.ctx.storage.sql.exec(
        `UPDATE agent_runs SET status = 'offline', address = NULL, port = NULL, derp_map_url = NULL WHERE agent_id = ? AND owner_id = ? AND status NOT IN ('ended','expired')`,
        agentId,
        ownerId,
      );
      return true;
    });
  }

  async getAgentGrantKey(
    ownerId: string,
    agentId: string,
  ): Promise<string | null> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT grant_key, revoked_at, token_expires_at FROM agents WHERE agent_id = ? AND owner_id = ?`,
        agentId,
        ownerId,
      )
      .next().value as
      | {
          grant_key: string;
          revoked_at: number | null;
          token_expires_at: number | null;
        }
      | undefined;
    if (
      !row ||
      row.revoked_at != null ||
      Number(row.token_expires_at) <= Date.now()
    )
      return null;
    return row.grant_key;
  }

  // --- Terminal sessions & grants ---

  async createTerminalSession(
    ownerId: string,
    agentId: string,
    workspaceLabel?: string,
  ): Promise<TerminalSessionRecord> {
    const agent = this.ctx.storage.sql
      .exec(
        `SELECT agent_id FROM agents WHERE agent_id = ? AND owner_id = ? AND revoked_at IS NULL`,
        agentId,
        ownerId,
      )
      .next().value;
    if (!agent) throw new Error("agent_not_found");
    const terminalSessionId = await randomId(16);
    const now = Date.now();
    this.sessionCapacity(ownerId);
    this.ctx.storage.sql.exec(
      `INSERT INTO terminal_sessions (terminal_session_id, owner_id, agent_id, workspace_label, status, created_at, ended_at)
       VALUES (?, ?, ?, ?, 'pending', ?, NULL)`,
      terminalSessionId,
      ownerId,
      agentId,
      workspaceLabel ?? null,
      now,
    );
    return {
      terminalSessionId,
      ownerId,
      agentId,
      workspaceLabel: workspaceLabel ?? null,
      status: "connecting",
      createdAt: now,
      endedAt: null,
    };
  }

  async getTerminalSession(
    ownerId: string,
    terminalSessionId: string,
  ): Promise<TerminalSessionRecord | null> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT terminal_session_id, owner_id, agent_id, workspace_label, status, created_at, ended_at, run_id, active_nonce, lease_expires_at, termination_requested
         FROM terminal_sessions WHERE terminal_session_id = ? AND owner_id = ?`,
        terminalSessionId,
        ownerId,
      )
      .next().value as
      | {
          terminal_session_id: string;
          owner_id: string;
          agent_id: string;
          workspace_label: string | null;
          status: string;
          run_id: string | null;
          termination_requested: number;
          active_nonce: string | null;
          lease_expires_at: number | null;
          created_at: number;
          ended_at: number | null;
        }
      | undefined;
    if (!row) return null;
    let status: TerminalSessionRecord["status"] =
      row.status === "pending"
        ? "connecting"
        : (row.status as TerminalSessionRecord["status"]);
    if (row.run_id && !["ended", "expired"].includes(status)) {
      const run = this.runRow(ownerId, row.run_id);
      if (!run || run.status === "expired") status = "expired";
      else if (run.status === "ended") status = "ended";
      else if (
        run.status === "offline" ||
        !run.address ||
        Date.now() - Number(run.last_seen_at) > RUN_OFFLINE_MS
      )
        status = "offline";
      else
        status =
          row.active_nonce && Number(row.lease_expires_at) > Date.now()
            ? "active"
            : "connecting";
    }
    return {
      runId: row.run_id,
      terminationRequested: Boolean(row.termination_requested),
      terminalSessionId: row.terminal_session_id,
      ownerId: row.owner_id,
      agentId: row.agent_id,
      workspaceLabel: row.workspace_label,
      status,
      createdAt: row.created_at,
      endedAt: row.ended_at,
    };
  }

  async mintGrant(
    ownerId: string,
    terminalSessionId: string,
    browserSessionId: string,
  ): Promise<GrantMintResult> {
    const browser = await this.getBrowserSession(browserSessionId);
    if (!browser || browser.ownerId !== ownerId)
      throw new Error("unauthorized");
    const session = await this.getTerminalSession(ownerId, terminalSessionId);
    if (
      !session ||
      session.status === "ended" ||
      session.status === "expired" ||
      session.status === "offline"
    ) {
      throw new Error("session_unavailable");
    }
    const grantKey = await this.getAgentGrantKey(ownerId, session.agentId);
    if (!grantKey) throw new Error("agent_revoked");
    const nonce = await randomId(12);
    const expUnix = Math.floor(Date.now() / 1000) + GRANT_TTL_SEC;
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    const generation = session.runId
      ? (this.runRow(ownerId, session.runId)?.generation ?? null)
      : null;
    const grant = await encodeGrant(
      session.agentId,
      grantKey,
      terminalSessionId,
      nonce,
      expUnix,
    );
    this.ctx.storage.transactionSync(() => {
      const browser = this.ctx.storage.sql
        .exec(
          `SELECT owner_id,expires_at,revoked_at FROM browser_sessions WHERE session_id = ?`,
          browserSessionId,
        )
        .next().value;
      const agent = this.ctx.storage.sql
        .exec(
          `SELECT revoked_at,token_expires_at,grant_key FROM agents WHERE agent_id = ? AND owner_id = ?`,
          session.agentId,
          ownerId,
        )
        .next().value;
      const current = this.ctx.storage.sql
        .exec(
          `SELECT status FROM terminal_sessions WHERE terminal_session_id = ? AND owner_id = ?`,
          terminalSessionId,
          ownerId,
        )
        .next().value;
      if (
        !browser ||
        browser.owner_id !== ownerId ||
        browser.revoked_at != null ||
        Number(browser.expires_at) <= Date.now()
      )
        throw new Error("unauthorized");
      if (
        !agent ||
        agent.revoked_at != null ||
        Number(agent.token_expires_at) <= Date.now() ||
        agent.grant_key !== grantKey
      )
        throw new Error("agent_revoked");
      if (!current || !["pending", "active"].includes(String(current.status)))
        throw new Error("session_unavailable");
      if (session.runId) {
        const run = this.runRow(ownerId, session.runId);
        if (
          !run ||
          run.status !== "online" ||
          Date.now() - Number(run.last_seen_at) > RUN_OFFLINE_MS ||
          (run.generation ?? null) !== generation
        )
          throw new Error("session_unavailable");
      }
      this.pruneGrants();
      this.capacity("grant_nonces", limits.grants);
      this.capacity(
        "grant_nonces",
        limits.grantsPerSession,
        "terminal_session_id = ?",
        terminalSessionId,
      );
      this.ctx.storage.sql.exec(
        `INSERT INTO grant_nonces (nonce, terminal_session_id, agent_id, exp_unix, created_at, browser_session_id, run_generation)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
        nonce,
        terminalSessionId,
        session.agentId,
        expUnix,
        Date.now(),
        browserSessionId,
        generation,
      );
    });
    return {
      grant,
      terminalSessionId,
      agentId: session.agentId,
      expUnix,
    };
  }

  async limitRequest(ip: string, kind: "poll" | "agent") {
    this.enforcePairingRate(
      `request:${kind}:${ip}`,
      kind === "poll" ? 2000 : 5000,
    );
    this.enforcePairingRate(`request:${kind}:global`, 100000);
  }
  async previewPairing(code: string, ownerId: string) {
    this.enforcePairingRate(`approve:${ownerId}`, 30);
    const row = this.ctx.storage.sql
      .exec(
        `SELECT machine_name, status, expires_at FROM pairing_attempts WHERE code = ?`,
        code.toUpperCase(),
      )
      .next().value;
    if (
      !row ||
      row.status !== "pending" ||
      Number(row.expires_at) <= Date.now()
    )
      throw new Error("pairing_unavailable");
    return { machineName: String(row.machine_name) };
  }

  async agentCredential(
    ownerId: string,
    agentId: string,
    token: string,
    operation: "renew" | "revoke",
    replacementToken?: string,
    operationId?: string,
  ) {
    const hash = await sha256(token);
    const nextHash = replacementToken ? await sha256(replacementToken) : "";
    return this.ctx.storage.transactionSync(() => {
      const agent = this.ctx.storage.sql
        .exec(
          `SELECT token_hash, revoked_at, token_expires_at, rotation_id, previous_token_hash FROM agents WHERE agent_id = ? AND owner_id = ?`,
          agentId,
          ownerId,
        )
        .next().value;
      if (
        !agent ||
        agent.revoked_at != null ||
        Number(agent.token_expires_at) <= Date.now()
      )
        throw new Error("unauthorized");
      if (operation === "renew") {
        if (
          !replacementToken ||
          !/^[A-Za-z0-9_-]{43}$/.test(replacementToken) ||
          !operationId ||
          !/^[A-Za-z0-9_-]{43}$/.test(operationId)
        )
          throw new Error("invalid_request");
        if (
          agent.rotation_id === operationId &&
          timingSafeEqual(String(agent.previous_token_hash), hash) &&
          timingSafeEqual(String(agent.token_hash), nextHash)
        )
          return { ok: true };
        if (
          !timingSafeEqual(String(agent.token_hash), hash) ||
          nextHash === hash
        )
          throw new Error("unauthorized");
        this.ctx.storage.sql.exec(
          `UPDATE agents SET token_hash = ?, previous_token_hash = ?, rotation_id = ?, token_expires_at = ? WHERE agent_id = ? AND owner_id = ?`,
          nextHash,
          hash,
          operationId,
          Date.now() + 30 * 86400000,
          agentId,
          ownerId,
        );
      } else {
        if (!timingSafeEqual(String(agent.token_hash), hash))
          throw new Error("unauthorized");
        this.ctx.storage.sql.exec(
          `UPDATE agents SET revoked_at = ? WHERE agent_id = ? AND owner_id = ?`,
          Date.now(),
          agentId,
          ownerId,
        );
      }
      return { ok: true };
    });
  }

  async agentSession(
    ownerId: string,
    agentId: string,
    agentToken: string,
    sessionId?: string,
    nonce?: string,
    runId?: string,
    generation?: string,
  ) {
    const hash = await sha256(agentToken);
    return this.ctx.storage.transactionSync(() => {
      const agent = this.ctx.storage.sql
        .exec(
          `SELECT token_hash, revoked_at, token_expires_at FROM agents WHERE agent_id = ? AND owner_id = ?`,
          agentId,
          ownerId,
        )
        .next().value;
      if (
        !agent ||
        agent.revoked_at != null ||
        Number(agent.token_expires_at) <= Date.now() ||
        !timingSafeEqual(String(agent.token_hash), hash)
      )
        throw new Error("unauthorized");
      if (!sessionId) {
        this.sessionCapacity(ownerId);
        const id = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          `INSERT INTO terminal_sessions (terminal_session_id, owner_id, agent_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)`,
          id,
          ownerId,
          agentId,
          Date.now(),
        );
        return { sessionId: id };
      }
      const now = Date.now();
      const session = this.ctx.storage.sql
        .exec(
          `SELECT status, active_nonce, lease_expires_at, run_id FROM terminal_sessions WHERE terminal_session_id = ? AND owner_id = ? AND agent_id = ?`,
          sessionId,
          ownerId,
          agentId,
        )
        .next().value;
      if (session?.status === "ended") throw new Error("session_ended");
      if (session?.status === "expired") throw new Error("session_expired");
      if (!session || !["pending", "active"].includes(String(session.status)))
        throw new Error("session_unavailable");
      if (session.run_id) {
        const run = this.runRow(ownerId, String(session.run_id));
        if (
          runId !== session.run_id ||
          !run ||
          (run.generation && run.generation !== generation) ||
          ["ended", "expired"].includes(String(run.status)) ||
          (nonce &&
            !["release:", "detach:", "ended:"].some((prefix) =>
              nonce.startsWith(prefix),
            ) &&
            (run.status !== "online" ||
              now - Number(run.last_seen_at) > RUN_OFFLINE_MS))
        )
          throw new Error("session_unavailable");
      }
      if (!nonce) return { sessionId }; // Agent/run status, never attachment authorization.
      const checking = nonce.startsWith("check:");
      const releasing =
        nonce.startsWith("release:") ||
        nonce.startsWith("detach:") ||
        nonce.startsWith("ended:");
      const leaseNonce =
        checking || releasing ? nonce.slice(nonce.indexOf(":") + 1) : nonce;
      if (releasing) {
        if (nonce.startsWith("detach:"))
          this.ctx.storage.sql.exec(
            `UPDATE terminal_sessions SET status = 'pending', active_nonce = NULL, lease_expires_at = NULL WHERE terminal_session_id = ? AND active_nonce = ?`,
            sessionId,
            leaseNonce,
          );
        else
          this.ctx.storage.sql.exec(
            `UPDATE terminal_sessions SET status = 'ended', ended_at = ?, active_nonce = NULL, lease_expires_at = NULL WHERE terminal_session_id = ? AND active_nonce = ?`,
            now,
            sessionId,
            leaseNonce,
          );
        return { sessionId };
      }
      if (checking) {
        if (
          session.active_nonce !== leaseNonce ||
          Number(session.lease_expires_at) <= now
        )
          throw new Error("unauthorized");
      } else if (session.active_nonce && Number(session.lease_expires_at) > now)
        throw new Error("session_busy");
      const grant = this.ctx.storage.sql
        .exec(
          `SELECT browser_session_id, exp_unix, consumed_at, run_generation FROM grant_nonces WHERE nonce = ? AND terminal_session_id = ? AND agent_id = ?`,
          leaseNonce,
          sessionId,
          agentId,
        )
        .next().value;
      if (
        !grant ||
        (session.run_id &&
          grant.run_generation !==
            (this.runRow(ownerId, String(session.run_id))?.generation ??
              null)) ||
        (!checking &&
          (grant.consumed_at != null ||
            Number(grant.exp_unix) <= Math.floor(now / 1000))) ||
        (checking && grant.consumed_at == null)
      )
        throw new Error("unauthorized");
      const browser = this.ctx.storage.sql
        .exec(
          `SELECT expires_at, revoked_at FROM browser_sessions WHERE session_id = ? AND owner_id = ?`,
          grant.browser_session_id,
          ownerId,
        )
        .next().value;
      if (
        !browser ||
        browser.revoked_at != null ||
        Number(browser.expires_at) <= now
      )
        throw new Error("unauthorized");
      if (!checking)
        this.ctx.storage.sql.exec(
          `UPDATE grant_nonces SET consumed_at = ? WHERE nonce = ?`,
          now,
          leaseNonce,
        );
      this.ctx.storage.sql.exec(
        `UPDATE terminal_sessions SET active_nonce = ?, lease_expires_at = ?, last_seen_at = ?, status = 'active' WHERE terminal_session_id = ?`,
        leaseNonce,
        now + 10000,
        now,
        sessionId,
      );
      return { sessionId };
    });
  }

  // --- Authenticated agent runs and safe dashboard metadata ---

  private expireRuns() {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `UPDATE agent_runs SET status = 'expired', address = NULL, port = NULL, derp_map_url = NULL WHERE status NOT IN ('ended','expired') AND last_seen_at <= ?`,
      now - RUN_EXPIRE_MS,
    );
    this.ctx.storage.sql.exec(
      `UPDATE terminal_sessions SET status = 'expired', active_nonce = NULL, lease_expires_at = NULL WHERE status NOT IN ('ended','expired') AND run_id IN (SELECT run_id FROM agent_runs WHERE status = 'expired')`,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM terminal_sessions WHERE status = 'expired' AND run_id NOT IN (SELECT run_id FROM agent_runs WHERE backend = 'tmux') AND created_at < ?`,
      now - 7 * RUN_EXPIRE_MS,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM agent_runs WHERE status IN ('ended','expired') AND backend != 'tmux' AND last_seen_at < ?`,
      now - 7 * RUN_EXPIRE_MS,
    );
  }

  private runRow(ownerId: string, runId: string) {
    this.expireRuns();
    return this.ctx.storage.sql
      .exec(
        `SELECT * FROM agent_runs WHERE run_id = ? AND owner_id = ?`,
        runId,
        ownerId,
      )
      .next().value;
  }

  async listRuns(ownerId: string): Promise<RunRecord[]> {
    this.expireRuns();
    const rows = this.ctx.storage.sql.exec(
      `SELECT r.* FROM agent_runs r JOIN agents a ON a.agent_id = r.agent_id AND a.owner_id = r.owner_id WHERE r.owner_id = ? AND a.revoked_at IS NULL ORDER BY r.created_at DESC LIMIT 100`,
      ownerId,
    );
    return [...rows].map((row) => ({
      backend: row.backend as "tmux" | "ephemeral",
      runId: String(row.run_id),
      agentId: String(row.agent_id),
      machineName: String(row.machine_name),
      workspaceLabel: String(row.workspace_label),
      status: (["ended", "expired"].includes(String(row.status))
        ? row.status
        : row.status === "offline" ||
            Date.now() - Number(row.last_seen_at) > RUN_OFFLINE_MS
          ? "offline"
          : !row.address
            ? "starting"
            : "online") as RunRecord["status"],
      lastSeenAt: Number(row.last_seen_at),
      createdAt: Number(row.created_at),
    }));
  }

  async listTerminalSessions(
    ownerId: string,
  ): Promise<TerminalSessionRecord[]> {
    this.expireRuns();
    const ids = [
      ...this.ctx.storage.sql.exec(
        `SELECT terminal_session_id FROM terminal_sessions WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100`,
        ownerId,
      ),
    ];
    const sessions = await Promise.all(
      ids.map((row) =>
        this.getTerminalSession(ownerId, String(row.terminal_session_id)),
      ),
    );
    return sessions.filter((s): s is TerminalSessionRecord => s !== null);
  }

  async agentRun(
    ownerId: string,
    agentId: string,
    token: string,
    update: RunUpdate,
  ): Promise<{ sessionId: string; terminateIds?: string[] }> {
    const hash = await sha256(token);
    if (
      update.backend === "tmux" &&
      (!update.generation || !/^[A-Za-z0-9_-]{16,64}$/.test(update.generation))
    )
      throw new Error("invalid_run");
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(update.runId))
      throw new Error("invalid_run");
    const newSessionId = await randomId(16);
    const result = this.ctx.storage.transactionSync(() => {
      const agent = this.ctx.storage.sql
        .exec(
          `SELECT token_hash, revoked_at, token_expires_at FROM agents WHERE agent_id = ? AND owner_id = ?`,
          agentId,
          ownerId,
        )
        .next().value;
      if (
        !agent ||
        agent.revoked_at != null ||
        Number(agent.token_expires_at) <= Date.now() ||
        !timingSafeEqual(String(agent.token_hash), hash)
      )
        throw new Error("unauthorized");
      const now = Date.now();
      if (update.operation === "start") {
        if (
          !update.machineName ||
          update.machineName.length > 64 ||
          !update.workspaceLabel ||
          update.workspaceLabel.length > 128 ||
          /[\x00-\x1f\x7f]/.test(update.machineName + update.workspaceLabel)
        )
          throw new Error("invalid_run");
        const existing = this.runRow(ownerId, update.runId);
        if (existing) {
          if (
            existing.agent_id !== agentId ||
            (existing.backend !== "tmux" &&
              ["ended", "expired"].includes(String(existing.status)))
          )
            throw new Error("session_unavailable");
          if (existing.backend !== (update.backend ?? "ephemeral"))
            throw new Error("session_unavailable");
          if (
            update.backend === "tmux" &&
            existing.generation !== update.generation
          ) {
            if (!update.generation) throw new Error("unauthorized");
            this.ctx.storage.sql.exec(
              `UPDATE agent_runs SET generation = ?, status = 'starting', address = NULL, port = NULL, last_seen_at = ? WHERE run_id = ?`,
              update.generation,
              now,
              update.runId,
            );
            this.ctx.storage.sql.exec(
              `DELETE FROM grant_nonces WHERE terminal_session_id IN (SELECT terminal_session_id FROM terminal_sessions WHERE run_id = ?)`,
              update.runId,
            );
            this.ctx.storage.sql.exec(
              `UPDATE terminal_sessions SET active_nonce = NULL, lease_expires_at = NULL, status = 'pending' WHERE run_id = ? AND status IN ('pending','active')`,
              update.runId,
            );
            for (const id of update.recoveredIds ?? []) {
              const row = this.ctx.storage.sql
                .exec(
                  `SELECT owner_id, agent_id, run_id, status, termination_requested FROM terminal_sessions WHERE terminal_session_id = ?`,
                  id,
                )
                .next().value;
              if (
                row &&
                (row.owner_id !== ownerId ||
                  row.agent_id !== agentId ||
                  row.run_id !== update.runId)
              )
                throw new Error("unauthorized");
              if (row && row.status === "expired" && !row.termination_requested)
                this.ctx.storage.sql.exec(
                  `UPDATE terminal_sessions SET status = 'pending', active_nonce = NULL, lease_expires_at = NULL WHERE terminal_session_id = ?`,
                  id,
                );
              if (!row) {
                this.sessionCapacity(ownerId, update.runId);
                this.ctx.storage.sql.exec(
                  `INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,run_id,workspace_label,status,created_at) VALUES (?,?,?,?,?,'pending',?)`,
                  id,
                  ownerId,
                  agentId,
                  update.runId,
                  update.workspaceLabel,
                  now,
                );
              }
            }
          }
        } else {
          this.capacity("agent_runs", limits.runs, "owner_id = ?", ownerId);
          this.ctx.storage.sql.exec(
            `INSERT INTO agent_runs (run_id,owner_id,agent_id,machine_name,workspace_label,status,created_at,last_seen_at,backend,generation) VALUES (?,?,?,?,?,'starting',?,?,?,?)`,
            update.runId,
            ownerId,
            agentId,
            update.machineName,
            update.workspaceLabel,
            now,
            now,
            update.backend ?? "ephemeral",
            update.generation ?? null,
          );
        }
        if (update.backend === "tmux")
          for (const id of update.recoveredIds ?? []) {
            const row = this.ctx.storage.sql
              .exec(
                `SELECT owner_id,agent_id,run_id,status FROM terminal_sessions WHERE terminal_session_id = ?`,
                id,
              )
              .next().value;
            if (
              row &&
              (row.owner_id !== ownerId ||
                row.agent_id !== agentId ||
                row.run_id !== update.runId)
            )
              throw new Error("unauthorized");
            if (!row) {
              this.sessionCapacity(ownerId, update.runId);
              this.ctx.storage.sql.exec(
                `INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,run_id,workspace_label,status,created_at) VALUES (?,?,?,?,?,'pending',?)`,
                id,
                ownerId,
                agentId,
                update.runId,
                update.workspaceLabel,
                now,
              );
            }
          }
        const open = this.ctx.storage.sql
          .exec(
            `SELECT terminal_session_id FROM terminal_sessions WHERE run_id = ? AND owner_id = ? AND status IN ('pending','active') AND termination_requested = 0 ORDER BY created_at LIMIT 1`,
            update.runId,
            ownerId,
          )
          .next().value;
        if (!open) {
          const used = this.ctx.storage.sql
            .exec(
              `SELECT terminal_session_id FROM terminal_sessions WHERE terminal_session_id = ?`,
              update.runId,
            )
            .next().value;
          const id = used ? newSessionId : update.runId;
          this.sessionCapacity(ownerId, update.runId);
          this.ctx.storage.sql.exec(
            `INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,workspace_label,status,created_at,run_id) VALUES (?,?,?,?,'pending',?,?)`,
            id,
            ownerId,
            agentId,
            update.workspaceLabel,
            now,
            update.runId,
          );
        }
      } else {
        const run = this.runRow(ownerId, update.runId);
        if (!run || run.agent_id !== agentId)
          throw new Error("session_unavailable");
        if (run.generation && run.generation !== update.generation)
          throw new Error("unauthorized");
        if (run.status === "ended" && update.operation === "end")
          return { sessionId: update.runId };
        if (["ended", "expired"].includes(String(run.status)))
          throw new Error("session_unavailable");
        if (update.operation === "announce") {
          if (
            !update.address ||
            !/^tc[A-Za-z0-9:_-]{10,250}$/.test(update.address) ||
            !Number.isInteger(update.port) ||
            update.port! < 1 ||
            update.port! > 65535
          )
            throw new Error("invalid_descriptor");
          if (update.derpMapURL) {
            const url = new URL(update.derpMapURL);
            if (
              url.protocol !== "https:" ||
              url.username ||
              url.password ||
              url.hash ||
              update.derpMapURL.length > 2048
            )
              throw new Error("invalid_descriptor");
          }
          this.ctx.storage.sql.exec(
            `UPDATE agent_runs SET address = ?, port = ?, derp_map_url = ?, status = 'online', last_seen_at = ? WHERE run_id = ?`,
            update.address,
            update.port!,
            update.derpMapURL || null,
            now,
            update.runId,
          );
        } else if (update.operation === "heartbeat") {
          if (!run.address) throw new Error("session_unavailable");
          this.ctx.storage.sql.exec(
            `UPDATE agent_runs SET status = 'online', last_seen_at = ? WHERE run_id = ?`,
            now,
            update.runId,
          );
        } else if (
          update.operation === "offline" ||
          update.operation === "end"
        ) {
          this.ctx.storage.sql.exec(
            `UPDATE agent_runs SET status = ?, last_seen_at = ?, ended_at = ?, address = NULL, port = NULL, derp_map_url = NULL WHERE run_id = ?`,
            update.operation === "end" && run.backend !== "tmux"
              ? "ended"
              : "offline",
            now,
            update.operation === "end" && run.backend !== "tmux" ? now : null,
            update.runId,
          );
          if (update.operation === "end" && run.backend !== "tmux")
            this.ctx.storage.sql.exec(
              `UPDATE terminal_sessions SET status = 'ended', ended_at = ?, active_nonce = NULL, lease_expires_at = NULL WHERE run_id = ? AND status NOT IN ('ended','expired')`,
              now,
              update.runId,
            );
        } else throw new Error("invalid_operation");
      }
      for (const id of update.endedIds ?? [])
        this.ctx.storage.sql.exec(
          `UPDATE terminal_sessions SET status = 'ended', ended_at = COALESCE(ended_at,?), active_nonce = NULL, lease_expires_at = NULL WHERE terminal_session_id = ? AND run_id = ? AND owner_id = ?`,
          now,
          id,
          update.runId,
          ownerId,
        );
      for (const id of update.terminatedIds ?? [])
        this.ctx.storage.sql.exec(
          `UPDATE terminal_sessions SET termination_requested = 0 WHERE terminal_session_id = ? AND run_id = ? AND owner_id = ? AND status = 'ended'`,
          id,
          update.runId,
          ownerId,
        );
      this.ctx.storage.sql.exec(
        `UPDATE agents SET last_seen_at = ? WHERE agent_id = ? AND owner_id = ?`,
        now,
        agentId,
        ownerId,
      );
      let open = this.ctx.storage.sql
        .exec(
          `SELECT terminal_session_id FROM terminal_sessions WHERE run_id = ? AND status IN ('pending','active') AND termination_requested = 0 ORDER BY created_at LIMIT 1`,
          update.runId,
        )
        .next().value;
      if (!open && update.operation === "start") {
        this.sessionCapacity(ownerId, update.runId);
        this.ctx.storage.sql.exec(
          `INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,workspace_label,status,created_at,run_id) VALUES (?,?,?,?,'pending',?,?)`,
          newSessionId,
          ownerId,
          agentId,
          update.workspaceLabel ?? "",
          now,
          update.runId,
        );
        open = { terminal_session_id: newSessionId };
      }
      const terminateIds = [
        ...this.ctx.storage.sql.exec(
          `SELECT terminal_session_id FROM terminal_sessions WHERE run_id = ? AND owner_id = ? AND termination_requested = 1 LIMIT 128`,
          update.runId,
          ownerId,
        ),
      ].map((row) => String(row.terminal_session_id));
      return {
        sessionId: open ? String(open.terminal_session_id) : update.runId,
        terminateIds,
      };
    });
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return result;
  }

  async startRunSession(
    ownerId: string,
    runId: string,
  ): Promise<TerminalSessionRecord> {
    const id = await randomId(16);
    const sessionId = this.ctx.storage.transactionSync(() => {
      const run = this.runRow(ownerId, runId);
      if (
        !run ||
        run.status !== "online" ||
        !run.address ||
        Date.now() - Number(run.last_seen_at) > RUN_OFFLINE_MS
      )
        throw new Error("agent_offline");
      const agent = this.ctx.storage.sql
        .exec(
          `SELECT revoked_at, token_expires_at FROM agents WHERE agent_id = ? AND owner_id = ?`,
          String(run.agent_id),
          ownerId,
        )
        .next().value;
      if (
        !agent ||
        agent.revoked_at != null ||
        Number(agent.token_expires_at) <= Date.now()
      )
        throw new Error("agent_offline");
      const existing = this.ctx.storage.sql
        .exec(
          `SELECT terminal_session_id FROM terminal_sessions WHERE run_id = ? AND owner_id = ? AND status IN ('pending','active') ORDER BY created_at DESC LIMIT 1`,
          runId,
          ownerId,
        )
        .next().value;
      if (existing) return String(existing.terminal_session_id);
      this.sessionCapacity(ownerId, runId);
      this.ctx.storage.sql.exec(
        `INSERT INTO terminal_sessions (terminal_session_id,owner_id,agent_id,workspace_label,status,created_at,run_id) VALUES (?,?,?,?,'pending',?,?)`,
        id,
        ownerId,
        String(run.agent_id),
        String(run.workspace_label),
        Date.now(),
        runId,
      );
      return id;
    });
    return (await this.getTerminalSession(ownerId, sessionId))!;
  }

  async endTerminalSession(ownerId: string, id: string): Promise<boolean> {
    const result = this.ctx.storage.sql.exec(
      `UPDATE terminal_sessions SET status = 'ended', termination_requested = CASE WHEN run_id IN (SELECT run_id FROM agent_runs WHERE backend = 'tmux') THEN 1 ELSE 0 END, ended_at = ?, active_nonce = NULL, lease_expires_at = NULL WHERE terminal_session_id = ? AND owner_id = ? AND status != 'ended'`,
      Date.now(),
      id,
      ownerId,
    );
    return result.rowsWritten > 0;
  }

  async resolveSession(
    ownerId: string,
    id: string,
    browserId: string,
  ): Promise<ResolvedSession> {
    const session = await this.getTerminalSession(ownerId, id);
    if (!session) throw new Error("not_found");
    if (session.status === "offline") throw new Error("agent_offline");
    if (["ended", "expired"].includes(session.status))
      throw new Error("session_" + session.status);
    const run = session.runId ? this.runRow(ownerId, session.runId) : null;
    if (
      !run ||
      run.status !== "online" ||
      !run.address ||
      Date.now() - Number(run.last_seen_at) > RUN_OFFLINE_MS
    )
      throw new Error("agent_offline");
    if (session.status === "active") throw new Error("session_busy");
    const grant = await this.mintGrant(ownerId, id, browserId);
    return {
      ...grant,
      backend: run.backend as "tmux" | "ephemeral",
      address: String(run.address),
      port: Number(run.port),
      ...(run.derp_map_url ? { derpMapURL: String(run.derp_map_url) } : {}),
    };
  }

  // --- Pairing hub (object name: pairing) ---

  async startPairing(
    machineName: string,
    clientIp: string,
  ): Promise<PairingStartResult> {
    if (
      !machineName.trim() ||
      /[\x00-\x1f\x7f]/.test(machineName) ||
      machineName.length > 64
    )
      throw new Error("invalid_machine_name");
    this.enforcePairingRate(`ip:${clientIp || "unknown"}`, PAIRING_IP_LIMIT);
    this.enforcePairingRate("global", PAIRING_GLOBAL_LIMIT);
    const attemptId = await randomId(16);
    const code = await randomCode();
    const cliSecret = await randomId(24);
    const now = Date.now();
    const expiresAt = now + PAIRING_TTL_MS;
    this.ctx.storage.sql.exec(
      `DELETE FROM pairing_attempts WHERE expires_at <= ?`,
      now,
    );
    const codeHash = await sha256(code),
      secretHash = await sha256(cliSecret);
    this.ctx.storage.transactionSync(() => {
      this.capacity("pairing_attempts", limits.pairingAttempts);
      this.ctx.storage.sql.exec(
        `INSERT INTO pairing_attempts (
         attempt_id, code, code_hash, cli_secret_hash, machine_name, client_ip,
         status, owner_id, agent_id, result_json, created_at, expires_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, ?, NULL)`,
        attemptId,
        code,
        codeHash,
        secretHash,
        machineName.trim(),
        clientIp || "unknown",
        now,
        expiresAt,
      );
    });
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    return { attemptId, code, cliSecret, expiresAt };
  }

  async approvePairing(
    code: string,
    ownerId: string,
  ): Promise<{ attemptId: string; machineName: string }> {
    this.enforcePairingRate(`approve:${ownerId}`, 30);
    const row = this.ctx.storage.sql
      .exec(
        `SELECT attempt_id, machine_name, status, expires_at FROM pairing_attempts WHERE code = ?`,
        code.toUpperCase(),
      )
      .next().value as
      | {
          attempt_id: string;
          machine_name: string;
          status: string;
          expires_at: number;
        }
      | undefined;
    if (!row) throw new Error("pairing_not_found");
    if (row.expires_at <= Date.now()) {
      this.ctx.storage.sql.exec(
        `UPDATE pairing_attempts SET status = 'expired' WHERE attempt_id = ? AND status = 'pending'`,
        row.attempt_id,
      );
      throw new Error("pairing_expired");
    }
    if (row.status !== "pending") throw new Error("pairing_unavailable");
    const result = this.ctx.storage.sql.exec(
      `UPDATE pairing_attempts
       SET status = 'claimed', owner_id = ?
       WHERE attempt_id = ? AND status = 'pending'`,
      ownerId,
      row.attempt_id,
    );
    if (result.rowsWritten !== 1) throw new Error("pairing_unavailable");
    return { attemptId: row.attempt_id, machineName: row.machine_name };
  }

  async completePairing(
    attemptId: string,
    ownerId: string,
    agent: {
      agentId: string;
      agentToken: string;
      grantKey: string;
      machineName: string;
    },
  ): Promise<void> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT status, owner_id, expires_at FROM pairing_attempts WHERE attempt_id = ?`,
        attemptId,
      )
      .next().value as
      | { status: string; owner_id: string | null; expires_at: number }
      | undefined;
    if (
      !row ||
      row.expires_at <= Date.now() ||
      row.status !== "claimed" ||
      row.owner_id !== ownerId
    ) {
      throw new Error("pairing_unavailable");
    }
    const resultJson = JSON.stringify({
      agentId: agent.agentId,
      agentToken: agent.agentToken,
      grantKey: agent.grantKey,
      machineName: agent.machineName,
      ownerId,
    });
    this.ctx.storage.sql.exec(
      `UPDATE pairing_attempts
       SET status = 'completed', agent_id = ?, result_json = ?, completed_at = ?
       WHERE attempt_id = ? AND status = 'claimed'`,
      agent.agentId,
      resultJson,
      Date.now(),
      attemptId,
    );
  }

  async abortPairing(attemptId: string, ownerId: string): Promise<void> {
    this.ctx.storage.sql.exec(
      `UPDATE pairing_attempts
       SET status = 'expired'
       WHERE attempt_id = ? AND owner_id = ? AND status = 'claimed'`,
      attemptId,
      ownerId,
    );
  }

  async pollPairing(
    code: string,
    cliSecret: string,
  ): Promise<PairingPollResult> {
    const row = this.ctx.storage.sql
      .exec(
        `SELECT status, expires_at, cli_secret_hash, result_json FROM pairing_attempts WHERE code = ?`,
        code.toUpperCase(),
      )
      .next().value as
      | {
          status: string;
          expires_at: number;
          cli_secret_hash: string;
          result_json: string | null;
        }
      | undefined;
    if (!row) return { status: "expired" };
    const secretHash = await sha256(cliSecret);
    return this.ctx.storage.transactionSync(() => {
      const current = this.ctx.storage.sql
        .exec(
          `SELECT status, expires_at, cli_secret_hash, result_json FROM pairing_attempts WHERE code = ?`,
          code.toUpperCase(),
        )
        .next().value as typeof row;
      if (!current) return { status: "expired" } as PairingPollResult;
      Object.assign(row, current);
      if (!timingSafeEqual(secretHash, row.cli_secret_hash))
        throw new Error("pairing_unauthorized");
      if (row.expires_at <= Date.now() || row.status === "expired") {
        this.ctx.storage.sql.exec(
          `UPDATE pairing_attempts SET status = 'expired', result_json = NULL WHERE code = ?`,
          code.toUpperCase(),
        );
        return { status: "expired" };
      }
      if (row.status === "completed" && row.result_json) {
        const parsed = JSON.parse(row.result_json) as {
          agentId: string;
          agentToken: string;
          grantKey: string;
          machineName: string;
          ownerId: string;
        };
        // One-time delivery: clear secrets after a successful authenticated poll.
        this.ctx.storage.sql.exec(
          `UPDATE pairing_attempts SET result_json = NULL, status = 'delivered' WHERE code = ? AND status = 'completed'`,
          code.toUpperCase(),
        );
        return { status: "completed", ...parsed };
      }
      if (row.status === "delivered") return { status: "expired" };
      if (row.status === "claimed") return { status: "claimed" };
      if (row.expires_at <= Date.now() || row.status === "expired")
        return { status: "expired" };
      return { status: "pending" };
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.expireRuns();
    this.ctx.storage.sql.exec(
      `DELETE FROM grant_nonces WHERE exp_unix < ? AND nonce NOT IN (SELECT active_nonce FROM terminal_sessions WHERE active_nonce IS NOT NULL AND lease_expires_at > ?)`,
      Math.floor(now / 1000),
      now,
    );
    this.ctx.storage.sql.exec(
      `UPDATE terminal_sessions SET active_nonce = NULL, lease_expires_at = NULL WHERE lease_expires_at <= ?`,
      now,
    );
    this.ctx.storage.sql.exec(
      `UPDATE terminal_sessions SET status = 'expired' WHERE run_id IS NULL AND COALESCE(last_seen_at,created_at) < ? AND status IN ('pending','active')`,
      now - 86400000,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM terminal_sessions WHERE ended_at < ? AND termination_requested = 0 AND run_id NOT IN (SELECT run_id FROM agent_runs WHERE backend = 'tmux')`,
      now - 7 * 86400000,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM browser_sessions WHERE expires_at < ?`,
      now - 86400000,
    );
    this.ctx.storage.sql.exec(
      `UPDATE pairing_attempts SET result_json = NULL, status = 'expired' WHERE expires_at <= ?`,
      now,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM pairing_attempts WHERE expires_at < ?`,
      now - 24 * 60 * 60 * 1000,
    );
    this.ctx.storage.sql.exec(
      `DELETE FROM pairing_rate WHERE window_start < ?`,
      now - PAIRING_WINDOW_MS,
    );
    const pending = this.ctx.storage.sql
      .exec(
        `SELECT (SELECT COUNT(*) FROM pairing_attempts)+(SELECT COUNT(*) FROM browser_sessions)+(SELECT COUNT(*) FROM terminal_sessions)+(SELECT COUNT(*) FROM grant_nonces) AS n`,
      )
      .next().value;
    if (Number(pending?.n)) await this.ctx.storage.setAlarm(now + 60_000);
  }

  private enforcePairingRate(bucket: string, limit: number): void {
    const now = Date.now();
    if (bucket.length > 200) throw new Error("invalid_request");
    this.ctx.storage.sql.exec(
      `DELETE FROM pairing_rate WHERE window_start <= ?`,
      now - PAIRING_WINDOW_MS,
    );
    const row = this.ctx.storage.sql
      .exec(
        `SELECT count, window_start FROM pairing_rate WHERE bucket = ?`,
        bucket,
      )
      .next().value as { count: number; window_start: number } | undefined;
    if (!row || now - row.window_start >= PAIRING_WINDOW_MS) {
      if (!row) this.capacity("pairing_rate", limits.rateBuckets);
      this.ctx.storage.sql.exec(
        `INSERT INTO pairing_rate (bucket, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(bucket) DO UPDATE SET count = 1, window_start = excluded.window_start`,
        bucket,
        now,
      );
      return;
    }
    if (row.count >= limit) throw new Error("pairing_rate_limited");
    this.ctx.storage.sql.exec(
      `UPDATE pairing_rate SET count = count + 1 WHERE bucket = ?`,
      bucket,
    );
  }
  health() {
    return {schema: Number([...this.ctx.storage.sql.exec('SELECT MAX(id) AS version FROM schema_migrations')][0]?.version ?? 0)};
  }

}

export default {
  fetch() {
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
