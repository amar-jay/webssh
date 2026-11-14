import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAuthEnv, type AuthEnv } from '#lib/auth/env.js';
import { runtimeEnv } from '#lib/cloudflare/runtime.js';

export const GET: RequestHandler = async ({ url, platform, cookies }) => {
  const env = await runtimeEnv(platform?.env as AuthEnv | undefined);
  if (!env) throw redirect(303, '/');
  let auth;
  try {
    auth = requireAuthEnv(env);
  } catch {
    throw redirect(303, '/?error=auth_not_configured');
  }
  const state = crypto.randomUUID();
  const redirectUri = `${auth.publicOrigin}/auth/github/callback`;
  const params = new URLSearchParams({
    client_id: auth.githubClientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state
  });
  const next = url.searchParams.get('next') || '/';
  const safeNext = next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
  cookies.set(auth.publicOrigin.startsWith('https:') ? '__Host-webssh_oauth' : 'webssh_oauth', JSON.stringify({ state, next: safeNext }), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: auth.publicOrigin.startsWith('https:'),
    maxAge: 600
  });
  return new Response(null, {
    status: 303,
    headers: {
      location: `https://github.com/login/oauth/authorize?${params}`
    }
  });
};
