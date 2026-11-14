import { DurableObject } from 'cloudflare:workers';

export interface Env {
  WEBSSH_STATE: DurableObjectNamespace<WebSSHState>;
}

// Add storage operations once ownership and the session schema are defined.
export class WebSSHState extends DurableObject<Env> {}

export default {
  fetch() {
    return new Response('Not found', { status: 404 });
  }
} satisfies ExportedHandler<Env>;
