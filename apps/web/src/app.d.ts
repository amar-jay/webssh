declare global {
  namespace App {
    interface Platform {
      env: {
        WEBSSH_STATE: import('@cloudflare/workers-types').DurableObjectNamespace;
        ASSETS: import('@cloudflare/workers-types').Fetcher;
      };
      context: import('@cloudflare/workers-types').ExecutionContext;
    }
  }
}

export {};
