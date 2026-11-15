import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { ownerStub, readForm } from "#lib/state/client.js";
import { loadWorkspace } from "#lib/workspace.js";

export const load: PageServerLoad = async ({ locals, platform, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  if (!locals.user) throw redirect(303, "/login?next=/sessions");
  const workspace = await loadWorkspace(platform, locals.user.ownerId);
  return { user: locals.user, ...workspace };
};

export const actions: Actions = {
  end: async ({ locals, request, platform }) => {
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
};
