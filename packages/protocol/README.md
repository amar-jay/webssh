# Shared protocol

Language-neutral specifications and fixtures for communication between the browser and remote agent will live here. They will cover terminal input/output, resize messages, session lifecycle, errors, and protocol versions.

Because the browser uses TypeScript and the agent uses Go, this directory will hold the common contract rather than assume both can import one implementation. Each application will implement the contract in its own language; shared fixtures can verify interoperability.

The transport and message encoding are not finalized yet.
