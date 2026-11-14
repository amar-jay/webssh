export async function runtimeEnv<T>(fallback?: T): Promise<T | undefined> {
  if (fallback) return fallback;
  try {
    // @ts-expect-error Cloudflare provides this virtual module at Worker runtime.
    const cloudflare = await import('cloudflare:workers');
    return cloudflare.env as T;
  } catch {
    return undefined;
  }
}
