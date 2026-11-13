# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Email **security@flutterwave.com** *(placeholder: to be confirmed by the Flutterwave security team before release)* with:

- a description of the problem and its impact,
- steps to reproduce, or a proof of concept,
- the version or commit you tested.

We aim to acknowledge reports within 2 working days and to share a fix plan within 10 working days.

## Supported versions

Security fixes go into the latest release only.

## Scope

In scope: this MCP server's code, its default configuration, and the npm package and Docker image built from this repository.

Out of scope: the Flutterwave APIs themselves (report those through the same address, but they are handled by the API teams), and third-party MCP clients.

## How the server handles security

See [docs/security.md](docs/security.md): threat model, controls, where they live in the code, the tests that prove them, and what remains.
