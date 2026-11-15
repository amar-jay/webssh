import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { loadWorkspace } from "#lib/workspace.js";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { ownerStub, readForm } from "#lib/state/client.js";

export const load: PageServerLoad = async ({
  locals,
  params,
  platform,
  setHeaders,
}) => {
  setHeaders({ "cache-control": "no-store" });
  if (!locals.user)
    throw redirect(
      303,
      `/login?next=${encodeURIComponent(`/machines/${params.machine_id}`)}`,
    );
  const workspace = await loadWorkspace(platform, locals.user.ownerId);
  if (workspace.unavailable)
    throw error(503, "Couldn’t load this machine. Try again shortly.");
  const agent = workspace.agents.find(
    (agent) => agent.agentId === params.machine_id,
  );
  if (!agent) throw error(404, "Machine unavailable.");
  return {
    agent,
    runs: workspace.runs.filter(
      (run) =>
        run.agentId === agent.agentId &&
        !["ended", "expired"].includes(run.status),
    ),
    sessions: workspace.sessions.filter(
      (session) => session.agentId === agent.agentId,
    ),
  };
};

export const actions: Actions = {
  start: async ({ locals, params, platform, request }) => {
    if (!locals.user) throw redirect(303, "/login");
    const env = await runtimeEnv(platform?.env);
    if (!env?.WEBSSH_STATE)
      return fail(503, { message: "Workspace service unavailable." });
    let runId: string | null;
    try {
      runId = (await readForm(request)).get("runId");
    } catch {
      return fail(400, { message: "Invalid or oversized form request." });
    }
    if (!runId || !/^[A-Za-z0-9_-]{16,64}$/.test(runId))
      return fail(400, { message: "Choose an available workspace." });
    let sessionId: string;
    try {
      const state = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
      const run = (await state.listRuns(locals.user.ownerId)).find(
        (run) => run.runId === runId && run.agentId === params.machine_id,
      );
      if (!run) return fail(404, { message: "Workspace unavailable." });
      sessionId = (await state.startRunSession(locals.user.ownerId, runId))
        .terminalSessionId;
    } catch (cause) {
      return fail(409, {
        message:
          cause instanceof Error && cause.message === "resource_limit"
            ? "Session limit reached. Open an existing session."
            : "Workspace offline. Run webssh serve on the machine, then refresh.",
      });
    }
    throw redirect(303, `/s/${encodeURIComponent(sessionId)}`);
  },
  end: async ({ locals, params, platform, request }) => {
    if (!locals.user) throw redirect(303, "/login");
    const env = await runtimeEnv(platform?.env);
    if (!env?.WEBSSH_STATE)
      return fail(503, { message: "Workspace service unavailable." });
    let sessionId: string | null;
    try {
      sessionId = (await readForm(request)).get("sessionId");
    } catch {
      return fail(400, { message: "Invalid or oversized form request." });
    }
    if (!sessionId || !/^[A-Za-z0-9_-]{16,64}$/.test(sessionId))
      return fail(400, { message: "Choose a session to end." });
    try {
      const state = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
      const session = await state.getTerminalSession(
        locals.user.ownerId,
        sessionId,
      );
      if (
        !session ||
        session.agentId !== params.machine_id ||
        !(await state.endTerminalSession(locals.user.ownerId, sessionId))
      ) {
        return fail(404, { message: "Session unavailable or already ended." });
      }
    } catch {
      return fail(503, { message: "Couldn’t end this session. Try again." });
    }
    return {
      message: "Termination requested. Waiting for the agent to confirm.",
    };
  },
};
