/** Temporary localhost sign-in. Production builds have DEV unset, so this cannot run there. */
export const DEV_OWNER_ID = "dev-local";
export const DEV_SESSION_ID = "dev-local";
export const DEV_COOKIE = "webssh_dev";

export function devLoginAllowed(url: URL): boolean {
  return (
    import.meta.env.DEV &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  );
}

export function devUser() {
  return {
    ownerId: DEV_OWNER_ID,
    sessionId: DEV_SESSION_ID,
    expiresAt: Date.now() + 14 * 24 * 60 * 60 * 1000,
  };
}

export function devCookie(maxAge: number): string {
  return `${DEV_COOKIE}=${maxAge > 0 ? "1" : ""}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}
