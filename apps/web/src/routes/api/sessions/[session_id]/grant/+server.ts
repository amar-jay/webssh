import type { RequestHandler } from './$types';
import type { AuthEnv } from '#lib/auth/env.js';
import { jsonError, noStore, ownerStub } from '#lib/state/client.js';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';

/** Resolve the descriptor and a single-use grant only for the authenticated owner. */
export const POST: RequestHandler = async ({ params, platform, locals }) => {
  if (!locals.user) return jsonError('unauthorized', 401);
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  if (!env?.WEBSSH_STATE) return jsonError('unavailable', 503);
  const terminalSessionId = params.session_id?.trim() ?? '';
  if (!terminalSessionId) return jsonError('invalid_session');
  try {
    const stub = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
    const session = await stub.getTerminalSession(locals.user.ownerId, terminalSessionId);
    if (!session) return jsonError('not_found', 404);
    const grant = await stub.resolveSession(locals.user.ownerId, terminalSessionId, locals.user.sessionId);
    return noStore(grant);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'grant_failed';
    if (['session_unavailable','agent_revoked','agent_offline','session_ended','session_expired','session_busy'].includes(message)) {
      return jsonError(message, 409);
    }
    return jsonError('session_unavailable', 503);
  }
};
