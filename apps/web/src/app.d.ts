declare module 'cloudflare:workers' {
  export const env: App.Platform['env'];
}

declare global {
  namespace App {
    interface Locals {
      user: { ownerId: string; sessionId: string; expiresAt: number } | null;
    }
    interface Platform {
      env: {
        WEBSSH_STATE: import('@cloudflare/workers-types').DurableObjectNamespace;
        ASSETS: import('@cloudflare/workers-types').Fetcher;
        GITHUB_CLIENT_ID?: string;
        GITHUB_CLIENT_SECRET?: string;
        SESSION_SECRET?: string;
        PUBLIC_ORIGIN?: string;
      };
      context: import('@cloudflare/workers-types').ExecutionContext;
    }
  }
}

export {};
