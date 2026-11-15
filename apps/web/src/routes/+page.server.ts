import { fail, redirect } from "@sveltejs/kit";
import type { PageServerLoad, Actions } from "./$types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { ownerStub, readForm } from "#lib/state/client.js";

export const load: PageServerLoad = async ({
  locals,
  url,
  platform,
  setHeaders,
}) => {
  setHeaders({ "cache-control": "no-store" });
  const base = { user: locals.user, error: url.searchParams.get("error") };
  if (!locals.user)
    return { ...base, agents: [], runs: [], sessions: [], unavailable: false };
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE)
    return { ...base, agents: [], runs: [], sessions: [], unavailable: true };
  try {
    const state = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
    const [agents, runs, sessions] = await Promise.all([
      state.listAgents(locals.user.ownerId),
      state.listRuns(locals.user.ownerId),
      state.listTerminalSessions(locals.user.ownerId),
    ]);
    return {
      ...base,
      agents: agents.filter((a) => !a.revokedAt),
      runs,
      sessions,
      unavailable: false,
    };
  } catch {
    return { ...base, agents: [], runs: [], sessions: [], unavailable: true };
  }
};

export const actions: Actions = {
  start: async ({ locals, request, platform, setHeaders }) => {
    if (!locals.user) throw redirect(303, "/login");
    const env = await runtimeEnv(platform?.env);
    if (!env?.WEBSSH_STATE)
      return fail(503, {
        message: "Workspace service is unavailable. Try again shortly.",
      });
    let data: URLSearchParams;
    try {
      data = await readForm(request);
    } catch {
      return fail(400, { message: "Invalid or oversized form request." });
    }
    const runId = data.get("runId");
    if (typeof runId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(runId))
      return fail(400, { message: "Choose an available workspace." });
    let id: string;
    try {
      id = (
        await ownerStub(
          env.WEBSSH_STATE as never,
          locals.user.ownerId,
        ).startRunSession(locals.user.ownerId, runId)
      ).terminalSessionId;
    } catch (error) {
      if (error instanceof Error && error.message === "resource_limit")
        return fail(409, {
          message:
            "This workspace has reached its session limit. Choose an existing session.",
        });
      return fail(409, {
        message:
          "This workspace is offline. Run webssh serve on the machine, then refresh.",
      });
    }
    throw redirect(303, `/s/${encodeURIComponent(id)}`);
  },
  end: async ({ locals, request, platform, setHeaders }) => {
    if (!locals.user) throw redirect(303, "/login");
    const env = await runtimeEnv(platform?.env);
    if (!env?.WEBSSH_STATE)
      return fail(503, {
        message: "Workspace service is unavailable. Try again shortly.",
      });
    let data: URLSearchParams;
    try {
      data = await readForm(request);
    } catch {
      return fail(400, { message: "Invalid or oversized form request." });
    }
    const id = data.get("sessionId");
    if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(id))
      return fail(400, { message: "Choose a session to end." });
    try {
      const ended = await ownerStub(
        env.WEBSSH_STATE as never,
        locals.user.ownerId,
      ).endTerminalSession(locals.user.ownerId, id);
      if (!ended)
        return fail(404, {
          message: "This session has already ended or is unavailable.",
        });
    } catch {
      return fail(503, {
        message: "Couldn’t end this session. Please try again.",
      });
    }
    return {
      message:
        "Termination requested. The agent will confirm after it next checks in.",
    };
  },
  revoke: async ({ locals, request, platform }) => {
    if (!locals.user) throw redirect(303, "/login");
    const env = await runtimeEnv(platform?.env);
    if (!env?.WEBSSH_STATE)
      return fail(503, {
        message: "Workspace service is unavailable. Try again shortly.",
      });
    let data: URLSearchParams;
    try {
      data = await readForm(request);
    } catch {
      return fail(400, { message: "Invalid or oversized form request." });
    }
    const id = data.get("agentId");
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id))
      return fail(400, { message: "Choose a machine to revoke." });
    try {
      if (
        !(await ownerStub(
          env.WEBSSH_STATE as never,
          locals.user.ownerId,
        ).revokeAgent(locals.user.ownerId, id))
      )
        return fail(404, {
          message: "This machine is unavailable or already revoked.",
        });
    } catch {
      return fail(503, {
        message: "Could not revoke access. Please try again.",
      });
    }
    return {
      message:
        "Access revoked. Current connections will detach on their next authorization check; tmux work remains on the machine.",
    };
  },
};
