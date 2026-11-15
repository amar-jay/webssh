import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { ownerStub, readForm } from "#lib/state/client.js";
import { loadWorkspace } from "#lib/workspace.js";

export const load: PageServerLoad = async ({ locals, platform, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  if (!locals.user) throw redirect(303, "/login?next=/dashboard");
  const workspace = await loadWorkspace(platform, locals.user.ownerId);
  return { user: locals.user, ...workspace };
};

export const actions: Actions = {
  start: async ({ locals, request, platform }) => {
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
