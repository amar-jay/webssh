# Web application

The SvelteKit application lives here, configured for Cloudflare Workers. It serves the browser interface and renders a full-screen xterm.js terminal at `/s/[session_id]`, with automatic focus, resizing, and cleanup. Real sessions attach through the owned Tailcat WASM transport and Protobuf protocol.

Server-side routes handle GitHub OAuth, pairing approval, grant minting, and Durable Object access through a Cloudflare binding. Terminal traffic travels through Tailcat.

SvelteKit and TypeScript are the `@webssh/web` pnpm workspace. Production attach uses HMAC grants after pairing. Local development can still use `/dev/connect` and explicit mock sessions.
