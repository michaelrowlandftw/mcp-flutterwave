# Design note: hosted server with OAuth sign-in (backlog item 15)

**Status:** note only. Nothing is built.

## Problem

Today each user runs the server locally and puts a long-lived secret key in their AI client's config file. Keys leak from laptops, and nothing ties a call to a person.

## Proposal

Run one Flutterwave-hosted MCP server over Streamable HTTP. Users sign in with their Flutterwave dashboard account through OAuth 2.1 (authorization code with PKCE), as the MCP authorization spec describes.

- The client discovers the authorization server from the MCP server's protected-resource metadata.
- The token is short-lived and scoped. Example scopes: `read`, `payments:write`, `transfers:write`, `live`.
- The server calls Flutterwave APIs on the user's behalf. No API key leaves Flutterwave.
- The controls in [../security.md](../security.md) stay on: read-only unless a write scope is granted, confirmation, amount caps, redaction and the trace tag. Per-user audit logs become possible because every call has an identity.

## Open points

- Which identity provider issues the tokens (the v4 IdP already used for client credentials is a candidate).
- How scopes map to dashboard roles and to sub-businesses.
- Whether test and live are separate audiences, so a test token can never touch live.
- Rate limits and abuse controls per user.
- Hosting, monitoring and incident ownership.

## Not in scope here

Building it. That needs a go-ahead after the security review.
