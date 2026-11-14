/** Hashing and id helpers for Durable Object storage. Never log raw secrets. */

const text = (value: string) => new TextEncoder().encode(value);

export async function randomId(bytes = 16): Promise<string> {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64Url(buf);
}

export async function randomCode(): Promise<string> {
  // 8 chars from Crockford-ish alphabet without ambiguous glyphs.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join('');
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', text(value));
  return base64Url(new Uint8Array(digest));
}

export async function encodeGrant(
  agentId: string,
  grantKey: string,
  terminalSessionId: string,
  nonce: string,
  expUnix: number
): Promise<string> {
  const message = `v1\n${agentId}\n${terminalSessionId}\n${expUnix}\n${nonce}`;
  const mac = await hmacSign(grantKey, message);
  return `v1.${terminalSessionId}.${expUnix}.${nonce}.${mac}`;
}

export async function hmacSign(keyMaterial: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    text(keyMaterial),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, text(message));
  return base64Url(new Uint8Array(mac));
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
