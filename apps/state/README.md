# State Worker

The Cloudflare Worker defining WebSSH’s SQLite-backed Durable Object classes will live here. It will manage connection metadata, preferences, and session records.

The web application will bind to these objects directly. A public HTTP API is not required for that access. Object ownership, authorization, and how data is divided between objects still need to be designed.

This Worker will have its own deployment configuration and storage migrations. It does not run shells or preserve remote processes.

This directory is a placeholder; the Worker has not been initialized yet.
