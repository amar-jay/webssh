import type { RequestHandler } from "./$types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { jsonError, noStore, ownerStub } from "#lib/state/client.js";

/** List only the signed-in owner's sessions within this exact agent run.
 * No grants or transport credentials are issued until a selection is attached.
 */
export const GET: RequestHandler = async ({ locals, params, platform }) => {
  if (!locals.user) return jsonError("unauthorized", 401);
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE) return jsonError("unavailable", 503);
  try {
    const state = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
    const reference = await state.getTerminalSession(
      locals.user.ownerId,
      params.session_id,
    );
    if (!reference) return jsonError("not_found", 404);
    const run = (await state.listRuns(locals.user.ownerId)).find(
      (run) =>
        run.runId === reference.runId && run.agentId === reference.agentId,
    );
    if (!run || run.backend !== "tmux")
      return noStore({ backend: "ephemeral", sessions: [] });
    const sessions = (await state.listTerminalSessions(locals.user.ownerId))
      .filter(
        (session) =>
          session.runId === run.runId &&
          session.agentId === run.agentId &&
          !session.terminationRequested &&
          !["ended", "expired"].includes(session.status),
      )
      .map((session) => ({
        id: session.terminalSessionId,
        status: session.status,
        createdAt: session.createdAt,
      }));
    return noStore({
      backend: "tmux",
      workspace: run.workspaceLabel,
      online: run.status === "online",
      sessions,
    });
  } catch {
    return jsonError("session_unavailable", 503);
  }
};

export const POST: RequestHandler = async ({ locals, params, platform }) => {
  if (!locals.user) return jsonError("unauthorized", 401);
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE) return jsonError("unavailable", 503);
  try {
    const state = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
    const reference = await state.getTerminalSession(
      locals.user.ownerId,
      params.session_id,
    );
    if (!reference) return jsonError("not_found", 404);
    const run = (await state.listRuns(locals.user.ownerId)).find(
      (run) =>
        run.runId === reference.runId &&
        run.agentId === reference.agentId &&
        run.backend === "tmux",
    );
    if (!run) return jsonError("session_unavailable", 409);
    const created = await state.startRunSession(
      locals.user.ownerId,
      run.runId,
      true,
    );
    return noStore({ sessionId: created.terminalSessionId }, 201);
  } catch (error) {
    if (error instanceof Error && error.message === "resource_limit")
      return jsonError("resource_limit", 429);
    return jsonError("agent_offline", 409);
  }
};
