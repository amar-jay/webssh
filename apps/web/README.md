# Web application

The hosted SvelteKit + TypeScript application will live here. It will serve the browser interface, render the terminal with xterm.js, and connect to the remote agent through Tailcat’s browser/WASM transport.

Server-side routes will handle authenticated application requests and access the state Worker’s Durable Objects through a Cloudflare binding. Terminal traffic will travel through Tailcat.
xterm.js and its Fit addon are installed; the terminal and Tailcat WASM integration are not implemented yet.


`wrangler.jsonc` declares the external `WEBSSH_STATE` Durable Object binding. Run `pnpm dev:state` in another terminal when developing against the state Worker. Authorization and state operations must be implemented before exposing application data through server routes.

Deployment is explicit: deploy `@webssh/state` first, then run `pnpm --filter @webssh/web deploy`. Nothing is deployed by the root build command.
