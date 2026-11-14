import { readJSON } from '#lib/state/client.js';
import type { RequestHandler } from './$types';
import { requireAuthEnv, type AuthEnv } from '#lib/auth/env.js';
import { clientIp, jsonError, noStore, pairingStub } from '#lib/state/client.js';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  if (!env?.WEBSSH_STATE) return jsonError('unavailable', 503);
  let auth;
  try {
    auth = requireAuthEnv(env);
  } catch {
    return jsonError('auth_not_configured', 503);
  }
  let body: { machineName?: string };
  try {
    body = (await readJSON(request)) as { machineName?: string };
  } catch {
    return jsonError('invalid_json');
  }
  if (!body || typeof body.machineName !== 'string') return jsonError('invalid_request');
  const machineName = body.machineName?.trim() ?? '';
  if (!machineName || machineName.length > 64) return jsonError('invalid_machine_name');
  try {
    const stub = pairingStub(env.WEBSSH_STATE as never);
    const started = await stub.startPairing(machineName, clientIp(request));
    return noStore({
      attemptId: started.attemptId,
      code: started.code,
      cliSecret: started.cliSecret,
      expiresAt: started.expiresAt,
      url: `${auth.publicOrigin}/pair?code=${encodeURIComponent(started.code)}`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pairing_failed';
    if (message === 'pairing_rate_limited') return jsonError(message, 429);
    return jsonError(message, 400);
  }
};
