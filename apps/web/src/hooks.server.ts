import type { Handle } from '@sveltejs/kit/hooks';
import { requireAuthEnv, type AuthEnv } from '#lib/auth/env.js';
import { readSessionCookie, verifySession } from '#lib/auth/session.js';
import { ownerStub } from '#lib/state/client.js';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';
import { DEV_COOKIE, devLoginAllowed, devUser } from '#lib/auth/dev-login.js';

export const handle: Handle = async (input) => {
  const response = await authenticate(input);
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options','nosniff');
  headers.set('referrer-policy','no-referrer');
  headers.set('x-frame-options','DENY');
  if(input.event.url.protocol==='https:') headers.set('strict-transport-security','max-age=31536000');
  return new Response(response.body, { status:response.status, statusText:response.statusText, headers });
};

const authenticate: Handle = async ({ event, resolve }) => {
  event.locals.user = null;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(event.request.method) && event.request.headers.get('cookie')?.includes('webssh_session=') && event.request.headers.get('origin') !== event.url.origin) {
    return new Response('Forbidden', { status: 403 });
  }
  if (devLoginAllowed(event.url) && event.cookies.get(DEV_COOKIE) === '1') {
    event.locals.user = devUser();
    return resolve(event);
  }
  const env = await runtimeEnv(event.platform?.env as AuthEnv | undefined);
  if (!env?.WEBSSH_STATE || !env.SESSION_SECRET) {
    return resolve(event);
  }
  try {
    const { sessionSecret } = requireAuthEnv(env);
    const raw = readSessionCookie(event.request.headers.get('cookie'), env.PUBLIC_ORIGIN?.startsWith('https:') ?? true);
    if (!raw) return resolve(event);
    const payload = await verifySession(raw, sessionSecret);
    if (!payload) return resolve(event);
    const stub = ownerStub(env.WEBSSH_STATE as never, payload.oid);
    const row = await stub.getBrowserSession(payload.sid);
    if (!row || row.ownerId !== payload.oid) return resolve(event);
    event.locals.user = { ownerId: payload.oid, sessionId: payload.sid, expiresAt: row.expiresAt };
  } catch {
    // Auth misconfiguration or DO errors leave the request unauthenticated.
  }
  return resolve(event);
};

export const handleError = () => {
 console.error(JSON.stringify({component:'app',event:'request_failed'}));
 return {message:'Request failed'};
};
