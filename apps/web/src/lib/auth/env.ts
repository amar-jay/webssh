export type AuthEnv = {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  SESSION_SECRET?: string;
  PUBLIC_ORIGIN?: string;
  WEBSSH_STATE: import("@cloudflare/workers-types").DurableObjectNamespace;
};

export function requireAuthEnv(env: AuthEnv): {
  githubClientId: string;
  githubClientSecret: string;
  sessionSecret: string;
  publicOrigin: string;
} {
  const githubClientId = env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const sessionSecret = env.SESSION_SECRET?.trim();
  const publicOrigin = env.PUBLIC_ORIGIN?.trim()?.replace(/\/$/, "");
  if (
    !githubClientId ||
    !githubClientSecret ||
    !sessionSecret ||
    !publicOrigin
  ) {
    throw new Error("auth_not_configured");
  }
  if (sessionSecret.length < 32) throw new Error("auth_not_configured");
  const origin = new URL(publicOrigin);
  if (
    origin.origin !== publicOrigin ||
    (origin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
  )
    throw new Error("auth_not_configured");
  return { githubClientId, githubClientSecret, sessionSecret, publicOrigin };
}
