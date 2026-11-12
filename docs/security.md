# How this server handles security

This page is for security reviewers. It lists the threats we designed against, the control for each, where it lives in the code, the test that proves it, and what remains open.

PR numbers refer to the review stack on `michaelrowlandftw/mcp-flutterwave`. They run #1 to #18, and each PR builds on the one before.

## Default configuration

| Setting | Default | What changes it |
|---|---|---|
| Credentials | Test only. v3 keys must start with `FLWSECK_TEST`; v4 must point at the sandbox | Nothing. Live mode is disabled until the security review is complete (#16) |
| API version | v4 (v3 only with `FLW_API_VERSION=v3`, or an old install with only a v3 key) | `FLW_API_VERSION` |
| Tools | Only those named in `--tools` (`all` for every tool) | `--tools` |
| Raw card tools | Off, even with `--tools=all` | `--enable-raw-card-tools` |
| Read-only mode | Off | `--read-only`, `--read-only=false`, `FLW_READ_ONLY` |
| Confirmation for money-moving tools | On | `FLW_CONFIRM=false` (for automated sandbox tests) |
| Amount cap | None | `FLW_MAX_AMOUNT`, `FLW_MAX_AMOUNT_<CURRENCY>` |
| Transport | stdio only (no network listener) | Hosted mode is a design note only |

**Live mode:** disabled. The `--allow-live` flag and `FLW_ALLOW_LIVE` were removed in #16. Live v3 keys and `FLW_ENVIRONMENT=production` stop start-up with a clear message. Turning live mode on again needs a code change after the security review.

## Threats and controls

### 1. Key leakage

| | |
|---|---|
| **Threat** | A secret key, OAuth client secret, encryption key or webhook hash ends up in tool output, an error, a log, or a live key is used by mistake |
| **Controls** | Test-only credentials by default. Redaction of every tool result, every thrown error and all console output. Removed: Flutterwave keys, bearer tokens, JWTs, exact values of secret env vars, secret JSON fields, Luhn-valid card numbers. The webhook tool never echoes the secret or the signature |
| **Code** | `src/config/livePolicy.ts`, `src/cli.ts` (#2, #16); `src/utils/redact.ts`, `src/logRedaction.ts`, `src/tools/policy.ts` (#15) |
| **Tests** | `livePolicy.test.ts`; `redact.test.ts` (keys, tokens, env values, JSON fields, cards, tool errors, log output, start-up order); `webhook.test.ts` ("never echoes") |
| **Remains** | Keys are still stored in plain text in the MCP client's config file, as with every local MCP server. See open question 2 |

### 2. Prompt injection leading to unwanted payments

| | |
|---|---|
| **Threat** | Text the AI reads (an email, a web page, a customer note) tells it to pay, refund or transfer |
| **Controls** | Only listed tools register. Read-only mode is available with `--read-only`. Every tool carries `readOnlyHint`, `destructiveHint` and `idempotentHint`, so clients can warn or block. The 23 money-moving tools never run on the first call: with an elicitation-capable client the user confirms directly; otherwise the server returns a summary and a single-use, 5-minute HMAC token bound to the exact arguments. An optional amount cap applies before anything is sent |
| **Code** | `src/tools/policy.ts` (#3); `src/config/toolSafety.ts` (#10); read-only in `src/cli.ts` and `policy.ts` (#11); `src/tools/confirm.ts` (#12) |
| **Tests** | `toolPolicy.test.ts`; `annotations.test.ts` (every tool classified, all hints on the real registry); `livePolicy.test.ts` (read-only); `confirm.test.ts` (token reuse, changed arguments, expiry, elicitation accept and decline, cap) |
| **Remains** | Without elicitation, the AI relays the user's "yes". The token proves the same arguments were shown first, but not that a person read them. Clients that support elicitation close this gap |

### 3. Card data through the AI model

| | |
|---|---|
| **Threat** | Card number, CVV or PIN pass through the model and its logs. That brings the merchant into PCI DSS scope |
| **Controls** | The 4 tools that take raw card data are not registered by default, even with `--tools=all`. Naming one without the switch stops start-up. Hosted checkout is recommended instead. Card fields and card numbers are redacted from output, including the confirmation summary |
| **Code** | `src/config/rawCardTools.ts`, `src/cli.ts`, `src/tools/policy.ts` (#4); `src/utils/redact.ts` (#15) |
| **Tests** | `toolPolicy.test.ts`, `livePolicy.test.ts` (card switch); `redact.test.ts` (confirmation summary of `charge_card`) |
| **Remains** | With the switch on, card data still reaches the model. See open question 1 |

### 4. Duplicate payments on retry

| | |
|---|---|
| **Threat** | A create times out or returns 503 but succeeds, and the AI retries. We saw this in the sandbox on 3 Nov 2026 |
| **Controls** | Every create gets a unique reference. v4 sends it as `X-Idempotency-Key`. A timeout, a 5xx or a reply without an ID counts as uncertain. The server then looks the record up by reference with backoff, and retries once with the same key only when nothing exists. Creates with no lookup return `unknown` and never retry. v3 failures return `unknown` with the reference and the tool to check |
| **Code** | `src/utils/reference.ts`, `src/tools/v4/safeCreate.ts`, `src/client/v4/http.ts` (#8) |
| **Tests** | `safeCreate.test.ts`: per create tool, a fault with the record existing gives one record; a fault with no record gives one retry with the same key. Also the fault switch. `reference.test.ts`. A sandbox run with `FLW_FAULT=503_no_id` found the real record |
| **Remains** | v3 has no automatic lookup, only guidance. Lookups for orders and transfers scan recent pages, because those list endpoints have no reference filter |

### 5. Forged or replayed webhooks

| | |
|---|---|
| **Threat** | Someone posts a fake "payment successful" webhook, or replays a real one |
| **Controls** | `verify_webhook` checks v3 `verif-hash` and the v4 `flutterwave-signature` (base64 HMAC-SHA256 of the raw body). The comparison is constant time over SHA-256 digests. A bad signature stops before parsing. The status is then fetched from the API, so the webhook's own status is never trusted. A repeated body is flagged and never "safe" |
| **Code** | `src/tools/webhook.ts` (#13) |
| **Tests** | `webhook.test.ts`: 10 real v3 Test Mode payloads; wrong, longer and missing signatures; v4 HMAC with a changed body; replay; the API status winning over the webhook |
| **Remains** | v4 parsing follows the docs only, because no real v4 webhook has been captured yet. Replay detection is per process, with no timestamp window. Dashboard resends are byte-identical, so they cannot be told apart from replays |

### 6. Giving value on an unconfirmed payment

| | |
|---|---|
| **Threat** | Goods are shipped or a wallet is credited on a pending, partial, wrong-currency or reversed payment |
| **Controls** | `verify_payment` returns `safe_to_give_value` only when the status is successful, the amount is at least the amount expected, and the currency and reference match. `verify_payout` is safe only on a final `SUCCESSFUL` with no reversal. There are separate v3 and v4 status maps with exact matching, and anything unlisted is `unknown`, never success. Every result names its environment. Create and webhook tools point to the verify tools |
| **Code** | `src/verify/statusMaps.ts`, `src/verify/environment.ts`, `src/tools/verify.ts`, `src/tools/policy.ts` (#9) |
| **Tests** | `verify.test.ts`: every known value per version; 13 unknown values; one case per mismatch; reversal after success |
| **Remains** | v3 status values are not fully documented (refund suffixes such as `completed-bank-transfer`). Status logic has not been replayed against fixtures from live GETs |

### 7. Dependency risk

| | |
|---|---|
| **Threat** | A vulnerable or unneeded package in the runtime |
| **Controls** | Removed 4 unused packages (`flutterwave-node-v3`, `colors`, `ts-node`, `nodemon`). Moved the demo-app packages (`express`, `@anthropic-ai/sdk`) to dev. Updated the MCP SDK to 1.32.2. Upgraded `zod` to 4.x (#17), which fixes GHSA-mrhx-c7xc-m3w5; the SDK accepts zod 3 or 4. Same-major `overrides` for patched `fast-uri`, `ip-address`, `body-parser` and `hono`. CI runs on every PR: tests and build on Node 20, 22 and 24, plus `npm audit` (blocking on critical runtime advisories) |
| **Code** | `package.json`, `package-lock.json`, `.github/workflows/ci.yml` (#15, #17) |
| **Tests** | CI; `npm ci` works from the lock file (npm 11) |
| **Remains** | None. `npm audit --omit=dev` reports 0 vulnerabilities (12 Nov 2026, after #17). 28 advisories were found at the start (12 Nov 2026) |

## Other controls

- **Usage tag:** every API call sends `User-Agent: mcp-flutterwave/<version>` and a fresh `X-Trace-Id`. They hold no customer data (#14).
- **Test fault switch:** `FLW_FAULT` works only against the v4 sandbox and is ignored elsewhere (#8).
- **Timeouts:** v4 calls time out after 60 seconds (`FLW_TIMEOUT_MS`), so a hung call becomes an "unknown" result, not a silent wait (#8).

## Open questions for the security team

1. **Raw card tools:** keep them behind an explicit switch, or remove them from the package?
2. **Key storage:** should the server read keys from the OS keychain (Windows Credential Manager, macOS Keychain) instead of the client config file?
3. **Hosted OAuth:** a hosted server with OAuth sign-in would remove long-lived keys from users' machines. See [design/hosted-oauth.md](design/hosted-oauth.md). Is this the preferred direction, and what review would it need?
4. **Security contact:** confirm the address in `SECURITY.md` (a placeholder for now).
