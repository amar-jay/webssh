import type { RequestHandler } from "./$types";
import { requireAuthEnv, type AuthEnv } from "#lib/auth/env.js";
import { clearSessionCookie } from "#lib/auth/session.js";
import { ownerStub } from "#lib/state/client.js";
import { runtimeEnv } from "#lib/cloudflare/runtime.js";

export const POST: RequestHandler = async ({ locals, platform }) => {
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  if (env?.WEBSSH_STATE && locals.user) {
    try {
      const stub = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
      await stub.revokeBrowserSession(locals.user.sessionId);
    } catch {
      return new Response("Logout unavailable; try again", { status: 503 });
    }
  }
  let secure = true;
  try {
    if (env) secure = requireAuthEnv(env).publicOrigin.startsWith("https:");
  } catch {
    secure = true;
  }
  const headers = new Headers({ location: "/", "cache-control": "no-store" });
  headers.append("set-cookie", clearSessionCookie(secure));
  return new Response(null, { status: 303, headers });
};
