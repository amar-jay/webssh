import type { RequestHandler } from './$types';
import type { AuthEnv } from '#lib/auth/env.js';
import { jsonError, noStore, ownerStub } from '#lib/state/client.js';

export const POST: RequestHandler = async ({ params, platform, locals }) => {
  if (!locals.user) return jsonError('unauthorized', 401);
  const env = platform?.env as AuthEnv | undefined;
  if (!env?.WEBSSH_STATE) return jsonError('unavailable', 503);
  const agentId = params.agent_id?.trim() ?? '';
  if (!agentId) return jsonError('invalid_agent');
  try {
    const stub = ownerStub(env.WEBSSH_STATE as never, locals.user.ownerId);
    const revoked = await stub.revokeAgent(locals.user.ownerId, agentId);
    if (!revoked) return jsonError('not_found', 404);
    return noStore({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'revoke_failed';
    return jsonError(message, 400);
  }
};
