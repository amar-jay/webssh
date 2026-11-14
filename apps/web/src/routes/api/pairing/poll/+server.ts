import { readJSON } from '#lib/state/client.js';
import type { RequestHandler } from './$types';
import type { AuthEnv } from '#lib/auth/env.js';
import { jsonError, noStore, pairingStub, clientIp } from '#lib/state/client.js';

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform?.env as AuthEnv | undefined;
  if (!env?.WEBSSH_STATE) return jsonError('unavailable', 503);
  let body: { code?: string; cliSecret?: string };
  try {
    body = (await readJSON(request)) as { code?: string; cliSecret?: string };
  } catch {
    return jsonError('invalid_json');
  }
  if (!body || typeof body.code !== 'string' || typeof body.cliSecret !== 'string') return jsonError('invalid_request');
  const code = body.code?.trim().toUpperCase() ?? '';
  const cliSecret = body.cliSecret?.trim() ?? '';
  if (!/^[A-Z0-9]{8}$/.test(code) || !/^[A-Za-z0-9_-]{32}$/.test(cliSecret)) return jsonError('invalid_request');
  try {
    const stub = pairingStub(env.WEBSSH_STATE as never);
    await stub.limitRequest(clientIp(request),'poll');
    const result = await stub.pollPairing(code, cliSecret);
    return noStore(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pairing_failed';
    if (message === 'pairing_rate_limited') return jsonError(message,429);
    if (message === 'pairing_unauthorized') return jsonError(message, 401);
    return jsonError(message, 400);
  }
};
