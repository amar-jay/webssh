# State Worker

The Cloudflare Worker exporting WebSSH’s `WebSSHState` Durable Object skeleton lives here. It will manage connection metadata, preferences, and session records.

The web application declares a direct binding to these objects. A public HTTP API is not required for that access; the Worker’s HTTP handler currently returns 404. Object ownership, authorization, and how data is divided between objects still need to be designed.

This Worker has its own deployment configuration and an initial SQLite-backed Durable Object migration. It does not run shells or preserve remote processes.

The Worker is initialized as the `@webssh/state` pnpm workspace; application storage operations are not implemented yet.
