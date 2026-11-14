# Web application

The SvelteKit application lives here, configured for Cloudflare Workers. It serves the browser interface and renders a full-screen xterm.js terminal at `/s/[session_id]`, with automatic focus, resizing, and cleanup. Connection to the remote agent through Tailcat’s browser/WASM transport is not implemented yet.

Server-side routes will handle authenticated application requests and access the state Worker’s Durable Objects through a Cloudflare binding. Terminal traffic will travel through Tailcat.

SvelteKit and TypeScript are initialized as the `@webssh/web` pnpm workspace. Authentication and remote session handling are still to come; the terminal currently uses browser-only mock session data with canned commands for UI development.
