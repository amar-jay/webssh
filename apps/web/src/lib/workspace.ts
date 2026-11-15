import type { AuthEnv } from "#lib/auth/env.js";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { ownerStub } from "#lib/state/client.js";

type Platform = { env?: unknown } | undefined;

export async function loadWorkspace(platform: Platform, ownerId: string) {
  const empty = {
    agents: [],
    runs: [],
    sessions: [],
    unavailable: true,
  };
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  // Local dev has no Durable Object. Show an empty workspace instead of a failure.
  if (!env?.WEBSSH_STATE)
    return import.meta.env.DEV ? { ...empty, unavailable: false } : empty;
  try {
    const state = ownerStub(env.WEBSSH_STATE as never, ownerId);
    const [agents, runs, sessions] = await Promise.all([
      state.listAgents(ownerId),
      state.listRuns(ownerId),
      state.listTerminalSessions(ownerId),
    ]);
    return {
      agents: agents.filter((agent) => !agent.revokedAt),
      runs,
      sessions,
      unavailable: false,
    };
  } catch {
    return empty;
  }
}
