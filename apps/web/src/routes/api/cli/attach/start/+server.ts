import type { RequestHandler } from './$types';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';
import { requireAuthEnv } from '#lib/auth/env.js';
import { readJSON, clientIp, pairingStub, jsonError, noStore } from '#lib/state/client.js';
export const POST: RequestHandler = async ({request,platform}) => {
  const env = await runtimeEnv(platform?.env);
  if (!env?.WEBSSH_STATE) return jsonError('unavailable',503);
  let origin: string;
  try { origin = requireAuthEnv(env).publicOrigin; } catch { return jsonError('auth_not_configured',503); }
  let body;
  try { body = await readJSON(request) as {sessionId?:string}; } catch { return jsonError('invalid_request'); }
  if (!body || typeof body.sessionId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(body.sessionId)) return jsonError('invalid_session');
  try {
    const attempt = await pairingStub(env.WEBSSH_STATE as never).startCLIAttach(body.sessionId,clientIp(request));
    return noStore({...attempt,url:`${origin}/attach?code=${attempt.code}`});
  } catch { return jsonError('resource_limit',429); }
};
