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
    "This machine is offline. Check that webssh serve is running. Its shell state is unknown.",
  session_ended: "This session has ended. Open / to start a new session.",
  session_expired:
    "This session has expired. Run webssh serve again and open its new URL.",
  session_busy:
    "This workspace already has a connected terminal. Close it before trying again.",
  agent_revoked:
    "This machine’s pairing has expired or been revoked. Pair the machine again.",
};

/** Descriptors and grants live only in this request/attachment closure, never page data or storage. */
export function attachPairedSession(
  controller: Controller,
  sessionId: string,
  options: {
    fetcher?: typeof fetch;
    attach?: typeof attachRemoteSession;
  } = {},
) {
  const lifetime = new AbortController();
  let remote: ReturnType<typeof attachRemoteSession> | undefined;
  let running = false;
  let generation = 0;
  const write = (text: string) => {
    if (!lifetime.signal.aborted) controller.terminal.write(`\r\n${text}\r\n`);
  };
  async function start() {
    if (running || lifetime.signal.aborted) return;
    running = true;
    const attempt = ++generation;
    remote?.dispose();
    write("Resolving your workspace…");
    try {
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
          problems[data.error] ??
            "Couldn’t reach your workspace. Check your connection and try again.",
        );
        return;
      }
      if (
        typeof data.address !== "string" ||
        !data.address.startsWith("tc") ||
        typeof data.grant !== "string" ||
        !data.grant.startsWith("v1.") ||
        !Number.isInteger(data.port) ||
        data.port < 1 ||
        data.port > 65535
      )
        throw new Error("invalid_descriptor");
      const connection: Connection = {
        address: data.address,
        token: data.grant,
        port: data.port,
        ...(data.derpMapURL ? { derpMapURL: data.derpMapURL } : {}),
      };
      remote = (options.attach ?? attachRemoteSession)(controller, connection, {
        signal: lifetime.signal,
        onState(state: SessionResult) {
          const messages = {
            connecting: "Connecting to your machine…",
            ready: "Connected.",
            failed:
              "Couldn’t connect to the agent. Check that webssh serve is running, then press r to try again.",
            disconnected:
              "Connection lost. The agent’s shell state is unknown. Open / to check availability.",
            exited: `Shell exited (${state.code ?? 0}). Open / to start a new session.`,
            disposed: "",
          };
          if (attempt !== generation) return;
          if (state.state !== "disposed") write(messages[state.state]);
          if (["failed", "disconnected", "exited"].includes(state.state))
            running = false;
        },
      });
      await remote.done;
    } catch {
      if (!lifetime.signal.aborted)
        write(
          "Couldn’t reach your workspace. Check your connection, then press r to try again.",
        );
    } finally {
      if (attempt === generation) running = false;
    }
  }
  const retry = controller.terminal.onData((text) => {
    if (!running && (text === "r" || text === "R")) void start();
  });
  const done = start();
  return {
    done,
    dispose() {
      lifetime.abort();
      retry.dispose();
      remote?.dispose();
    },
  };
}
