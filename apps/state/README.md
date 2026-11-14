# State Worker

The Cloudflare Worker exporting WebSSH’s `WebSSHState` Durable Object lives here. It stores owner profiles, browser sessions, paired agents, pairing attempts, terminal session records, and grant metadata.

The web application declares a direct binding to these objects. A public HTTP API is not required for that access; the Worker’s HTTP handler currently returns 404. Owner objects are named `owner:<github_user_id>`; pairing uses a shared `pairing` object. Authorization is derived from the authenticated browser session, not from a client-supplied object id.

This Worker has its own deployment configuration and SQLite-backed Durable Object migrations. It does not run shells or preserve remote processes.

The Worker is the `@webssh/state` pnpm workspace. See [identity and pairing](../../docs/identity-pairing.md).
