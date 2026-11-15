export type OwnerRecord = {
  ownerId: string;
  githubLogin: string;
  createdAt: number;
};

export type AgentRecord = {
  agentId: string;
  ownerId: string;
  machineName: string;
  revokedAt: number | null;
  createdAt: number;
  lastSeenAt: number | null;
};

export type TerminalSessionRecord = {
  terminalSessionId: string;
  ownerId: string;
  agentId: string;
  workspaceLabel: string | null;
  status: "connecting" | "offline" | "active" | "ended" | "expired";
  runId?: string | null;
  terminationRequested?: boolean;
  createdAt: number;
  endedAt: number | null;
};

export type PairingStartResult = {
  attemptId: string;
  code: string;
  cliSecret: string;
  expiresAt: number;
};

export type PairingPollResult =
  | { status: "pending" | "expired" | "claimed" }
  | {
      status: "completed";
      agentId: string;
      agentToken: string;
      grantKey: string;
      machineName: string;
      ownerId: string;
    };

export type GrantMintResult = {
  grant: string;
  terminalSessionId: string;
  agentId: string;
  expUnix: number;
};

export type PublicError = { error: string };

/** RPC surface shared without importing Worker runtime declarations into DOM code. */
export type CLIAttachApproval = {
  sessionId: string;
  ownerId: string;
  browserId: string;
};
export interface StateAPI {
  startCLIAttach(
    sessionId: string,
    ip: string,
  ): Promise<{ code: string; cliSecret: string; expiresAt: number }>;
  previewCLIAttach(code: string): Promise<{ sessionId: string }>;
  approveCLIAttach(
    code: string,
    ownerId: string,
    browserId: string,
  ): Promise<void>;
  pollCLIAttach(
    code: string,
    secret: string,
  ): Promise<
    | { status: "pending" | "expired" }
    | ({ status: "approved" } & CLIAttachApproval)
  >;
  listAgents(ownerId: string): Promise<AgentRecord[]>;
  listRuns(ownerId: string): Promise<RunRecord[]>;
  listTerminalSessions(ownerId: string): Promise<TerminalSessionRecord[]>;
  agentRun(
    ownerId: string,
    agentId: string,
    token: string,
    update: RunUpdate,
  ): Promise<{ sessionId: string; terminateIds?: string[] }>;
  startRunSession(
    ownerId: string,
    runId: string,
    createNew?: boolean,
  ): Promise<TerminalSessionRecord>;
  endTerminalSession(ownerId: string, id: string): Promise<boolean>;
  resolveSession(
    ownerId: string,
    id: string,
    browserId: string,
  ): Promise<ResolvedSession>;

  limitRequest(ip: string, kind: "poll" | "agent"): Promise<void>;
  agentCredential(
    ownerId: string,
    agentId: string,
    token: string,
    operation: "renew" | "revoke",
    replacementToken?: string,
    operationId?: string,
  ): Promise<{ ok: boolean }>;
  ensureOwner(ownerId: string, login: string): Promise<OwnerRecord>;
  createBrowserSession(
    ownerId: string,
  ): Promise<{ sessionId: string; expiresAt: number }>;
  getBrowserSession(
    id: string,
  ): Promise<{ ownerId: string; expiresAt: number } | null>;
  revokeBrowserSession(id: string): Promise<void>;
  registerAgent(
    ownerId: string,
    name: string,
  ): Promise<{ agentId: string; agentToken: string; grantKey: string }>;
  revokeAgent(ownerId: string, id: string): Promise<boolean>;
  getTerminalSession(
    ownerId: string,
    id: string,
  ): Promise<TerminalSessionRecord | null>;
  mintGrant(
    ownerId: string,
    id: string,
    browserId: string,
  ): Promise<GrantMintResult>;
  startPairing(name: string, ip: string): Promise<PairingStartResult>;
  previewPairing(
    code: string,
    ownerId: string,
  ): Promise<{ machineName: string }>;
  approvePairing(
    code: string,
    ownerId: string,
  ): Promise<{ attemptId: string; machineName: string }>;
  completePairing(
    id: string,
    ownerId: string,
    agent: {
      agentId: string;
      agentToken: string;
      grantKey: string;
      machineName: string;
    },
  ): Promise<void>;
  abortPairing(id: string, ownerId: string): Promise<void>;
  pollPairing(code: string, secret: string): Promise<PairingPollResult>;
  agentSession(
    ownerId: string,
    agentId: string,
    token: string,
    id?: string,
    nonce?: string,
    runId?: string,
    generation?: string,
  ): Promise<{ sessionId: string }>;
}

export type RunUpdate = {
  operation: "start" | "announce" | "heartbeat" | "offline" | "end";
  runId: string;
  backend?: "tmux" | "ephemeral";
  generation?: string;
  recoveredIds?: string[];
  endedIds?: string[];
  terminatedIds?: string[];
  machineName?: string;
  workspaceLabel?: string;
  address?: string;
  port?: number;
  derpMapURL?: string;
};

/** Safe dashboard metadata, deliberately excludes transport descriptors and credentials. */
export type RunRecord = {
  runId: string;
  agentId: string;
  machineName: string;
  workspaceLabel: string;
  backend: "tmux" | "ephemeral";
  status: "starting" | "online" | "offline" | "ended" | "expired";
  lastSeenAt: number;
  createdAt: number;
};
export type ResolvedSession = GrantMintResult & {
  address: string;
  port: number;
  derpMapURL?: string;
  backend?: "tmux" | "ephemeral";
};
