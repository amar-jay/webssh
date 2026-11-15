import {
  attachRemoteSession,
  type Connection,
  type SessionResult,
} from "../terminal/remote-session.js";
import type { SessionTerminal } from "../terminal/create-terminal.js";

type Controller = Pick<SessionTerminal, "terminal">;
const problems: Record<string, string> = {
  unauthorized:
    "Sign in at / with the GitHub account used to pair this machine, then reload.",
  not_found:
    "This session is unavailable. Open / to choose one of your workspaces.",
  agent_offline:
    "This machine is offline. Waiting for the agent; shell state is unknown.",
  session_ended: "This session has ended. Open / to start a new session.",
  session_expired:
    "This session is expired. Restart webssh serve to recover its durable workspace.",
  session_busy:
    "Another controller is attached. Close or detach it; WebSSH never takes over automatically.",
  agent_revoked:
    "This machine’s pairing expired or was revoked. Pair the machine again.",
  session_not_found:
    "The agent cannot find this persistent session. Open / to start a new one.",
  backend_unavailable:
    "The persistent backend is unavailable. Check tmux and the agent on your machine.",
  capability_mismatch:
    "This agent does not support the required persistent-session capabilities. Update the CLI.",
  unsupported_protocol:
    "This agent uses an incompatible protocol. Update the CLI and restart serve.",
};
const retryErrors = new Set([
  "agent_offline",
  "session_busy",
  "session_expired",
  "session_unavailable",
  "rate_limited",
]);

/** Fresh credentials on every reconnect; no input queue survives an attachment. */
export function attachPairedSession(
  controller: Controller,
  sessionId: string,
  options: {
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
  const write = (text: string) => {
    if (!lifetime.signal.aborted) controller.terminal.write(`\r\n${text}\r\n`);
  };
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
          write(
            `Reconnecting (${retry}/${options.maxRetries ?? 6})… No input will be replayed.`,
          );
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
          write("Resolving your workspace…");
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
            write(
              typeof problems[data.error] === "string"
                ? problems[data.error]
                : "Couldn’t reach your workspace.",
            );
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
                    write(
                      data.backend === "ephemeral"
                        ? "Connected to an ephemeral shell. Disconnecting ends it."
                        : "Connected. Reloading or closing this tab detaches your durable session.",
                    );
                  } else if (state.state === "connecting")
                    write("Connecting to your machine…");
                  else if (state.state === "exited")
                    write(
                      state.code === undefined
                        ? "Remote session ended."
                        : `Shell exited (${state.code}).`,
                    );
                  else if (state.state === "terminated")
                    write("Remote session terminated.");
                  else if (state.state === "detached")
                    write(
                      data.backend === "ephemeral"
                        ? "Detached. The ephemeral shell is ending."
                        : "Detached. Your tmux session is preserved.",
                    );
                  else if (state.state === "disconnected")
                    write(
                      "Connection lost. Shell state is unknown; requesting fresh authorization.",
                    );
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
            if (result.reason && !["session_busy"].includes(result.reason)) {
              write(
                problems[result.reason] ??
                  "The agent rejected this connection.",
              );
              terminalExit = true;
              return;
            }
            if (data.backend === "ephemeral") {
              write(
                "This is an ephemeral workspace. Open / to start a new shell.",
              );
              terminalExit = true;
              return;
            }
          }
        } catch {
          if (lifetime.signal.aborted) return;
          write("Couldn’t reach the workspace. Its shell state is unknown.");
        }
        if (!shouldRetry) return;
      }
      if (!lifetime.signal.aborted)
        write(
          "Reconnect attempts stopped. Check that serve is running, then press r to retry.",
        );
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
