import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuthEnv, type AuthEnv } from '#lib/auth/env.js';
import { MAX_AGE_SEC, sessionCookie, signSession } from '#lib/auth/session.js';
import { ownerStub } from '#lib/state/client.js';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  if (!env?.WEBSSH_STATE) throw redirect(303, '/?error=auth_failed');
  let auth;
  try {
    auth = requireAuthEnv(env);
  } catch {
    throw redirect(303, '/?error=auth_not_configured');
  }

  const oauthRaw = cookies.get(auth.publicOrigin.startsWith('https:') ? '__Host-webssh_oauth' : 'webssh_oauth');
  cookies.delete(auth.publicOrigin.startsWith('https:') ? '__Host-webssh_oauth' : 'webssh_oauth', { path: '/' });
  let oauth: { state: string; next: string } | null = null;
  try {
    oauth = oauthRaw ? (JSON.parse(oauthRaw) as { state: string; next: string }) : null;
  } catch {
    oauth = null;
  }
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!oauth || !state || !code || state !== oauth.state) {
    throw redirect(303, '/?error=auth_failed');
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: auth.githubClientId,
      client_secret: auth.githubClientSecret,
      code,
      redirect_uri: `${auth.publicOrigin}/auth/github/callback`
    })
  });
  if (!tokenRes.ok) throw redirect(303, '/?error=auth_failed');
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) throw redirect(303, '/?error=auth_failed');

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${tokenJson.access_token}`,
      'user-agent': 'webssh'
    }
  });
  if (!userRes.ok) throw redirect(303, '/?error=auth_failed');
  const user = (await userRes.json()) as { id: number; login: string };
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || typeof user.login !== 'string' || !user.login) throw redirect(303, '/?error=auth_failed');
  const ownerId = String(user.id);
  const stub = ownerStub(env.WEBSSH_STATE as never, ownerId);
  await stub.ensureOwner(ownerId, user.login);
  const session = await stub.createBrowserSession(ownerId);
  const token = await signSession(
    { sid: session.sessionId, oid: ownerId, exp: Math.floor(session.expiresAt / 1000) },
    auth.sessionSecret
  );

  const secure = auth.publicOrigin.startsWith('https:');
  const headers = new Headers({
    location: oauth.next?.startsWith('/') && !oauth.next.startsWith('//') && !oauth.next.includes('\\') ? oauth.next : '/',
    'set-cookie': sessionCookie(token, secure),
    'cache-control': 'no-store'
  });
  // Keep Max-Age aligned with server session TTL.
  void MAX_AGE_SEC;
  return new Response(null, { status: 303, headers });
};
