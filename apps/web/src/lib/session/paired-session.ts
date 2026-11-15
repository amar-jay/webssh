import {
  attachRemoteSession,
  type Connection,
  type SessionResult,
} from "../terminal/remote-session.js";
import type { SessionTerminal } from "../terminal/create-terminal.js";

type Controller = Pick<SessionTerminal, "terminal">;
const problems: Record<string, string> = {
  resource_limit:
    "Workspace capacity reached. Wait for unused grants to expire, or choose an existing session from Machines.",
  unauthorized:
    "Sign in at / with the GitHub account used to pair this machine, then reload.",
  not_found:
    "This session is unavailable. Open Machines to choose a workspace.",
  agent_offline:
    "This machine is offline. Waiting for the agent; shell state is unknown.",
  session_ended: "This session has ended. Open Machines to start a new session.",
  session_expired:
    "This session is expired. Restart webssh serve to recover its durable workspace.",
  session_busy:
    "Detach the other controller, then retry. WebSSH never takes over automatically.",
  agent_revoked:
    "This machine’s pairing expired or was revoked. Pair the machine again.",
  session_not_found:
    "The agent cannot find this persistent session. Open Machines to start a new one.",
  backend_unavailable:
    "The persistent backend is unavailable. Check tmux and the agent on your machine.",
  capability_mismatch:
    "This agent does not support the required persistent-session capabilities. Update the CLI.",
  unsupported_protocol:
    "This agent uses an incompatible protocol. Update the CLI and restart serve.",
};
const retryErrors = new Set([
  "agent_offline",
  "session_unavailable",
  "rate_limited",
]);

export type ConnectionStatus = {
  phase: "connecting" | "retrying" | "blocked" | "failed" | "ended";
  message: string;
  detail?: string;
  retryable?: boolean;
  attempt?: number;
  maxRetries?: number;
};

/** Fresh credentials on every reconnect; no input queue survives an attachment. */
export function attachPairedSession(
  controller: Controller,
  sessionId: string,
  options: {
    onStatus?: (status: ConnectionStatus | null) => void;
    fetcher?: typeof fetch;
    attach?: typeof attachRemoteSession;
    maxRetries?: number;
    retryDelays?: number[];
  } = {},
) {
  const lifetime = new AbortController();
  let remote: ReturnType<typeof attachRemoteSession> | undefined;
  let running = false,
    terminalExit = false;
  const show = (status: ConnectionStatus | null) => {
    if (!lifetime.signal.aborted) options.onStatus?.(status);
  };
  const problem = (reason: string) => show({
    phase: reason === "session_busy" ? "blocked" : "failed",
    message: reason === "session_busy" ? "Session in use" : "Cannot connect",
    detail: problems[reason] ?? "The agent rejected this connection.",
    retryable: reason === "session_busy",
  });
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        lifetime.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, ms);
      lifetime.signal.addEventListener("abort", finish, { once: true });
      if (lifetime.signal.aborted) finish();
    });
  async function start() {
    if (running || lifetime.signal.aborted || terminalExit) return;
    running = true;
    try {
      for (
        let retry = 0;
        retry <= (options.maxRetries ?? 6) && !lifetime.signal.aborted;
        retry++
      ) {
        if (retry) {
          show({ phase: "retrying", message: "Reconnecting", detail: "Requesting fresh authorization. No input will be replayed.", attempt: retry, maxRetries: options.maxRetries ?? 6 });
          await sleep(
            (options.retryDelays ?? [500, 1000, 2000, 4000, 8000, 8000])[
              Math.min(retry - 1, (options.retryDelays?.length ?? 6) - 1)
            ] ?? 8000,
          );
        }
        if (lifetime.signal.aborted) return;
        remote?.dispose();
        let shouldRetry = true;
        try {
          show({ phase: "connecting", message: "Resolving your workspace", ...(retry ? { attempt: retry, maxRetries: options.maxRetries ?? 6 } : {}) });
          const response = await (options.fetcher ?? fetch)(
            `/api/sessions/${encodeURIComponent(sessionId)}/grant`,
            {
              method: "POST",
              credentials: "same-origin",
              cache: "no-store",
              signal: AbortSignal.any([
                lifetime.signal,
                AbortSignal.timeout(8_000),
              ]),
            },
          );
          const data = await response.json();
          if (lifetime.signal.aborted) return;
          if (!response.ok) {
            problem(data.error);
            if (data.error === "session_busy") return;
            shouldRetry = retryErrors.has(data.error);
            if (!shouldRetry) {
              terminalExit = true;
              return;
            }
          } else {
            if (
              typeof data.address !== "string" ||
              !data.address.startsWith("tc") ||
              typeof data.grant !== "string" ||
              !data.grant.startsWith("v1.") ||
              !Number.isInteger(data.port) ||
              data.port < 1 ||
              data.port > 65535
            )
              throw Error("invalid_descriptor");
            let readyAt = 0;
            const connection: Connection = {
              address: data.address,
              token: data.grant,
              port: data.port,
              sessionId,
              backend: data.backend,
              ...(data.derpMapURL ? { derpMapURL: data.derpMapURL } : {}),
            };
            remote = (options.attach ?? attachRemoteSession)(
              controller,
              connection,
              {
                signal: lifetime.signal,
                onState(state: SessionResult) {
                  if (state.state === "ready") {
                    readyAt = Date.now();
                    show(null);
                  } else if (state.state === "connecting") {
                    show({ phase: "connecting", message: "Connecting to your machine", ...(retry ? { attempt: retry, maxRetries: options.maxRetries ?? 6 } : {}) });
                  } else if (state.state === "exited") {
                    show({ phase: "ended", message: state.code === undefined ? "Remote session ended" : `Shell exited (${state.code})` });
                  } else if (state.state === "terminated") {
                    show({ phase: "ended", message: "Remote session terminated" });
                  } else if (state.state === "detached") {
                    show({ phase: "ended", message: "Detached", detail: data.backend === "ephemeral" ? "The ephemeral shell is ending." : "Your tmux session is preserved." });
                  } else if (state.state === "disconnected") {
                    show({ phase: "retrying", message: "Connection lost", detail: "Shell state is unknown. Requesting fresh authorization." });
                  }
                },
              },
            );
            const result = await remote.done;
            // A later outage after a stable connection gets its own bounded budget.
            if (readyAt && Date.now() - readyAt >= 30_000) retry = 0;
            if (lifetime.signal.aborted) return;
            if (
              ["exited", "terminated", "detached", "disposed"].includes(
                result.state,
              )
            ) {
              terminalExit = true;
              return;
            }
            if (result.reason) {
              problem(result.reason);
              if (result.reason !== "session_busy") terminalExit = true;
              return;
            }
            if (data.backend === "ephemeral") {
              show({ phase: "ended", message: "Ephemeral shell disconnected", detail: "Open Machines to start a new shell." });
              terminalExit = true;
              return;
            }
          }
        } catch {
          if (lifetime.signal.aborted) return;
          show({ phase: "retrying", message: "Workspace unreachable", detail: "Shell state is unknown." });
        }
        if (!shouldRetry) return;
      }
      if (!lifetime.signal.aborted)
        show({ phase: "failed", message: "Reconnect paused", detail: "Check that webssh serve is running, then press r to retry.", retryable: true });
    } finally {
      running = false;
    }
  }
  const retry = controller.terminal.onData((text) => {
    if (!running && (text === "r" || text === "R")) void start();
  });
  const done = start();
  return {
    done,
    retry: start,
    detach() {
      terminalExit = true;
      remote?.detach();
    },
    terminate() {
      terminalExit = true;
      remote?.terminate();
    },
    dispose() {
      lifetime.abort();
      retry.dispose();
      remote?.dispose();
    },
  };
}
