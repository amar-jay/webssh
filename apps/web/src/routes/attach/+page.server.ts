import { fail, redirect } from "@sveltejs/kit";
import type { PageServerLoad, Actions } from "./$types";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";
import { ownerStub, pairingStub, readForm } from "#lib/state/client.js";
export const load: PageServerLoad = async ({
  url,
  locals,
  platform,
  setHeaders,
}) => {
  setHeaders({ "cache-control": "no-store" });
  const code = url.searchParams.get("code") ?? "";
  if (!locals.user)
    throw redirect(
      303,
      `/login?next=${encodeURIComponent("/attach?code=" + code)}`,
    );
  if (!/^[A-Z0-9]{8}$/.test(code))
    return { code: "", workspace: null, user: locals.user };
  const env = await runtimeEnv(platform?.env);
  try {
    if (!env?.WEBSSH_STATE) throw Error();
    const attempt = await pairingStub(
      env.WEBSSH_STATE as never,
    ).previewCLIAttach(code);
    const session = await ownerStub(
      env.WEBSSH_STATE as never,
      locals.user.ownerId,
    ).getTerminalSession(locals.user.ownerId, attempt.sessionId);
    if (!session || ["ended", "expired"].includes(session.status))
      throw Error();
    return {
      code,
      workspace: session.workspaceLabel || "Workspace",
      user: locals.user,
    };
  } catch {
    return { code: "", workspace: null, user: locals.user };
  }
};
export const actions: Actions = {
  default: async ({ request, locals, platform }) => {
    if (!locals.user) throw redirect(303, "/login");
    const env = await runtimeEnv(platform?.env);
    try {
      const code = (await readForm(request)).get("code");
      if (!code || !/^[A-Z0-9]{8}$/.test(code) || !env?.WEBSSH_STATE)
        throw Error();
      const hub = pairingStub(env.WEBSSH_STATE as never);
      const attempt = await hub.previewCLIAttach(code);
      const session = await ownerStub(
        env.WEBSSH_STATE as never,
        locals.user.ownerId,
      ).getTerminalSession(locals.user.ownerId, attempt.sessionId);
      if (!session || ["ended", "expired"].includes(session.status))
        throw Error();
      await hub.approveCLIAttach(
        code,
        locals.user.ownerId,
        locals.user.sessionId,
      );
      return { approved: true };
    } catch {
      return fail(409, {
        approved: false,
        message:
          "Request unavailable. Start webssh attach again for a fresh link.",
      });
    }
  },
};
