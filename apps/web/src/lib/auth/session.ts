export type SessionPayload = {
  sid: string;
  oid: string;
  exp: number;
};

const COOKIE = '__Host-webssh_session';
const cookieName = (secure: boolean) => secure ? COOKIE : 'webssh_session';
const MAX_AGE_SEC = 14 * 24 * 60 * 60;

const text = (value: string) => new TextEncoder().encode(value);

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    text(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, text(message)));
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = b64url(text(JSON.stringify(payload)));
  const mac = await hmac(secret, body);
  return `${body}.${b64url(mac)}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  if(token.length>4096)return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, mac] = parts;
  const expected = await hmac(secret, body);
  let actual: Uint8Array;
  try { actual = fromB64url(mac); } catch { return null; }
  if (!timingSafeEqual(actual, expected)) return null;
  try {
    const json = new TextDecoder().decode(fromB64url(body));
    const payload = JSON.parse(json) as SessionPayload;
    if (typeof payload.sid !== 'string' || !payload.sid || typeof payload.oid !== 'string' || !payload.oid || !Number.isSafeInteger(payload.exp)) return null;
    if (payload.exp * 1000 <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function sessionCookie(token: string, secure: boolean): string {
  const parts = [
    `${cookieName(secure)}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SEC}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [`${cookieName(secure)}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(cookieHeader: string | null, secure = true): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === cookieName(secure)) return rest.join('=');
  }
  return null;
}

export { COOKIE, MAX_AGE_SEC };
