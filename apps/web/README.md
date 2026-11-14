# Web application

The hosted SvelteKit application will live here. It will serve the browser interface, render the terminal with xterm.js, and connect to the remote agent through Tailcat’s browser/WASM transport.

Server-side routes will handle authenticated application requests and access the state Worker’s Durable Objects through a Cloudflare binding. Terminal traffic will travel through Tailcat.

This directory is a placeholder; SvelteKit has not been initialized yet.
