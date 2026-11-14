import type { RequestHandler } from './$types';
import type { AuthEnv } from '#lib/auth/env.js';
import { jsonError, noStore, ownerStub } from '#lib/state/client.js';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';

/** Mint a short-lived attach grant for an owned terminal session. No Tailcat address here yet (milestone 3). */
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
    const grant = await stub.mintGrant(locals.user.ownerId, terminalSessionId, locals.user.sessionId);
    return noStore(grant);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'grant_failed';
    if (message === 'session_unavailable' || message === 'agent_revoked') {
      return jsonError(message, 409);
    }
    return jsonError(message, 400);
  }
};
