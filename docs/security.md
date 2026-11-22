# How this server handles security

This page is for security reviewers. It lists the threats we designed against, the control for each, where it lives in the code, the test that proves it, and what remains open.

PR numbers refer to the review stack on `michaelrowlandftw/mcp-flutterwave`. They run #1 to #21 (#19 was closed as a duplicate of #17), and each PR builds on the one before; v2.0.0 (`main`, `d6266b8`) holds all of them. The branch `feat/security-review` applies Security's review of DX-RFC-001 (2026-11-17), adopted by Michael on 2026-11-22: see [Security's decisions](#securitys-decisions-dx-rfc-001-2026-11-17).

## Default configuration

| Setting | Default | What changes it |
|---|---|---|
| Credentials | Test only. v3 keys must start with `FLWSECK_TEST`; v4 must point at the sandbox | Nothing. Live mode is off in code (`LIVE_MODE_APPROVED = false`) until Security approves it |
| Key store | Environment (MCP client config or `FLW_ENV_FILE`) | `FLW_KEY_SOURCE=keychain`. With live keys the keychain is required unless `FLW_KEY_SOURCE=env` is set on purpose |
| API version | v4 (v3 only with `FLW_API_VERSION=v3`, or an old install with only a v3 key) | `FLW_API_VERSION` |
| Tools | Only those named in `--tools` (`all` for every tool; refused with live keys) | `--tools` |
| Raw card tools | **Removed from the package** (none take a card number, CVV or PIN) | Nothing. `--enable-raw-card-tools` and `FLW_ENABLE_RAW_CARD_TOOLS` stop start-up |
| Read-only mode | Off in test mode; **on with live keys** | `--read-only`, `--read-only=false`, `FLW_READ_ONLY` (live: only `--read-only=false` on the command line) |
| Confirmation for money-moving tools and `initiate_bvn_verification` | On | `FLW_CONFIRM=false` (test mode only; refused with live keys) |
| Live approval per money-moving category | Required with live keys | `FLW_LIVE_APPROVED_CATEGORIES` (`collections`, `payouts`, `refunds`, `disputes`, `bills`, `fx`, `identity`) |
| Amount cap | None in test mode; with live keys a cap **per currency used** (`FLW_MAX_AMOUNT` alone is not enough) | `FLW_MAX_AMOUNT`, `FLW_MAX_AMOUNT_<CURRENCY>` |
| Confirmation in clients that can't ask the person | Allowed in test mode (token flow); blocked with live credentials | `FLW_REQUIRE_ELICITATION=true` blocks it in test mode too |
| Env file | None: a `.env` in the working folder is not read | `FLW_ENV_FILE` (credentials and API version only) |
| Callback and redirect URLs | https only (localhost http in test mode) | `FLW_ALLOWED_URL_HOSTS` (required with live keys) |
| Transport | stdio only (no network listener) | Hosted mode is a design note only |
| Docker image | `--tools=all --read-only` | The container's arguments |

**Live mode:** disabled. Every condition Security set is checked at start-up (`src/config/livePolicy.ts`), and the refusal lists the ones a setup still lacks, so an approval can be tested against a real configuration. Turning it on is one code change, `LIVE_MODE_APPROVED`, after Security's sign-off.

## Security's decisions (DX-RFC-001, 2026-11-17)

Adopted as written by Michael on 2026-11-22. Each row is decided; "Remains" says what is still open.

| # | Security's comment | What was done | Code and tests | Remains |
|---|---|---|---|---|
| 1 | Remove raw card tools from the official package: even behind a switch, card data reaches the model provider (PCI DSS) | Removed v3 `charge_card`, v4 `create_card_payment_method`, `create_orchestrator_charge`, `create_orchestrator_order`, the PIN path of `update_charge`, the 3DES and AES-GCM card encryption, the encryption-key settings and their docs. The old switch stops start-up. A `pin` field in any tool input is refused. Card-number redaction stays as defence in depth | `src/cli.ts`, `src/tools/policy.ts`, `src/tools/v4/updateCharge.ts`; `securityReview.test.ts`, `lowFindings.test.ts`, `redact.test.ts` | None |
| 1a | (Michael) card-via-API parity with Stripe and Paystack without raw card data | Hosted checkout is the default. New `charge_tokenized_card` (`POST /v3/tokenized-charges`): a money-moving tool behind confirmation, caps and the `collections` approval, which returns the 3DS redirect. v4 charges a saved `payment_method_id` with `create_charge` | `src/tools/charge.ts`, `src/client/lib/charge.ts`; `securityReview.test.ts` | **To verify** in Test Mode: a card saved from a 3DS checkout can be tokenised, every tokenised charge runs 3DS by default (customer present), customer-not-present needs Flutterwave's enablement |
| 2 | BVN: `get_bvn_details` match / no-match only, no identity data in text or UI card; `initiate_bvn_verification` takes a full BVN with no confirmation. Remove both unless there is a support use case | Michael confirmed a support use case (2026-11-22), so both stay in the restricted form: `get_bvn_details` takes the names (and optional date of birth) the caller expects and answers per field `match`, `no_match` or `not_available`, with no UI card; `initiate_bvn_verification` is confirmed like a money tool and has its own live category, `identity`. `bvn` values are redacted from output | `src/tools/verification.ts`, `src/config/toolSafety.ts` (`CONFIRMED_WRITES`); `securityReview.test.ts` | The record's date-of-birth format is undocumented; dates the server can't read are `not_available`. Not yet run against Test Mode |
| 3 | Keys from the OS keychain by default for live mode | `FLW_KEY_SOURCE=keychain` reads credentials from macOS Keychain, libsecret (`secret-tool`) or Windows PasswordVault. Live keys must come from it unless `FLW_KEY_SOURCE=env` is set on purpose | `src/config/keychain.ts`; `securityReview.test.ts` | Windows path untested. See [Key storage](#key-storage) |
| 4 | Live mode accepted with: elicitation required, a cap for every currency used, `FLW_ALLOWED_URL_HOSTS` set, `FLW_CONFIRM=false` refused, shared stores if more than one instance; plus a per-tool allowlist (no `--tools=all`), no raw card tools, read-only by default, a separate approval per money-moving category | All checked at start-up and per call. Shared stores: the server is stdio only (one process per person) and with live keys the token flow is off, so the in-memory stores hold; a multi-instance server is part of the hosted-OAuth RFC | `src/config/livePolicy.ts`, `src/tools/confirm.ts`, `src/cli.ts`; `securityReview.test.ts`, `livePolicy.test.ts` | Live mode stays off until Security signs off this branch |
| 5 | Release integrity: branch protection, CODEOWNERS, npm trusted publishing (OIDC) instead of `NPM_TOKEN`, signed images with an SBOM and provenance, a full pen test | CODEOWNERS added; `publish.yml` uses OIDC (no token, no pushes to `main`); `docker.yml` adds SBOM, provenance and a keyless cosign signature | `.github/`, [release.md](release.md) | Branch protection and the npm trusted-publisher setting must be set by an admin ([release.md](release.md)). **Pen test: Security to arrange.** No release workflow has run yet |
| 6 | Demo web app: move it to a separate repository or remove it | Removed (Michael chose removal, 2026-11-22), with its dev-only packages. It stays in git history | - | None |
| 7 | Security contact: the address in `SECURITY.md` is correct | `SECURITY.md` names security@flutterwave.com as confirmed | `SECURITY.md` | None |
| 8 | Hosted OAuth: right direction; needs its own RFC, a security review and a security test | Nothing built. [design/hosted-oauth.md](design/hosted-oauth.md) stays a design note | - | Its own RFC |

## Key storage

With `FLW_KEY_SOURCE=keychain` the server reads `FLW_SECRET_KEY`, `FLW_CLIENT_ID`, `FLW_CLIENT_SECRET` and `FLW_SECRET_HASH` from the OS keychain, service `mcp-flutterwave`, account = the variable name. It never writes to the keychain, and a credential set both in the keychain mode and in the environment stops start-up, so there is one source only. Safety switches are never read from the keychain.

Store a key once with the OS tool (it prompts for the value, so it stays out of shell history):

```bash
security add-generic-password -s mcp-flutterwave -a FLW_SECRET_KEY -w
```

```bash
secret-tool store --label="mcp-flutterwave FLW_SECRET_KEY" service mcp-flutterwave account FLW_SECRET_KEY
```

On Windows, add a Web Credential with resource `mcp-flutterwave` and user name `FLW_SECRET_KEY` (PasswordVault); this path is untested.

## Threats and controls

### 1. Key leakage

| | |
|---|---|
| **Threat** | A secret key, OAuth client secret, encryption key or webhook hash ends up in tool output, an error, a log, or a live key is used by mistake |
| **Controls** | Test-only credentials by default. OS keychain storage (`src/config/keychain.ts`). Redaction of every tool result, every thrown error and all console output. Removed: Flutterwave keys, bearer tokens, JWTs, exact values of secret env vars, secret JSON fields, Luhn-valid card numbers. The webhook tool never echoes the secret or the signature |
| **Code** | `src/config/livePolicy.ts`, `src/cli.ts` (#2, #16); `src/utils/redact.ts`, `src/logRedaction.ts`, `src/tools/policy.ts` (#15) |
| **Tests** | `livePolicy.test.ts`; `redact.test.ts` (keys, tokens, env values, JSON fields, cards, tool errors, log output, start-up order); `webhook.test.ts` ("never echoes") |
| **Remains** | In test mode keys are usually in the MCP client's config file, as with every local MCP server. `FLW_KEY_SOURCE=keychain` moves them to the OS keychain and is required for live keys (decision 3) |

### 2. Prompt injection leading to unwanted payments

| | |
|---|---|
| **Threat** | Text the AI reads (an email, a web page, a customer note) tells it to pay, refund or transfer |
| **Controls** | Only listed tools register. Read-only mode is available with `--read-only`. Every tool carries `readOnlyHint`, `destructiveHint` and `idempotentHint`, so clients can warn or block. The money-moving tools, and `initiate_bvn_verification`, never run on the first call: with an elicitation-capable client the user confirms directly; otherwise the server returns a summary and a single-use, 5-minute HMAC token bound to the exact arguments. An optional amount cap applies before anything is sent |
| **Code** | `src/tools/policy.ts` (#3); `src/config/toolSafety.ts` (#10); read-only in `src/cli.ts` and `policy.ts` (#11); `src/tools/confirm.ts` (#12) |
| **Tests** | `toolPolicy.test.ts`; `annotations.test.ts` (every tool classified, all hints on the real registry); `livePolicy.test.ts` (read-only); `confirm.test.ts` (token reuse, changed arguments, expiry, elicitation accept and decline, cap) |
| **Remains** | Without elicitation, the AI relays the user's "yes". The token proves the same arguments were shown first, but not that a person read them. Clients that support elicitation close this gap, and live mode requires them. With live keys each money-moving category also needs its own approval |

### 3. Card data through the AI model

| | |
|---|---|
| **Threat** | Card number, CVV or PIN pass through the model and its logs. That brings the merchant into PCI DSS scope |
| **Controls** | No tool takes card data: the raw card tools were removed (decision 1). Card payments use hosted checkout or a tokenised charge of a card saved from a 3DS checkout. A `pin` field anywhere in a tool's input is refused before anything is sent. Card fields and card numbers are still redacted from output, including the confirmation summary |
| **Code** | `src/cli.ts`, `src/tools/policy.ts`, `src/tools/v4/updateCharge.ts`, `src/tools/charge.ts`; `src/utils/redact.ts` (#15) |
| **Tests** | `securityReview.test.ts` (removed from both allowlists and both real registries, the old switch refused, no PIN in `update_charge`, tokenised charge takes a token only); `lowFindings.test.ts` (PIN refused in any tool); `redact.test.ts` (confirmation summary) |
| **Remains** | A user can still paste a card number into the chat; the model provider sees it, though no tool accepts it. The tokenised-charge 3DS behaviour is unverified |

### 3a. Identity data through the AI model (BVN)

| | |
|---|---|
| **Threat** | BVN records (name, date of birth, phone, NIN, photo, watchlist status) reach the model, its logs and the UI |
| **Controls** | `get_bvn_details` returns match / no-match per field only, with no UI card. `initiate_bvn_verification` is confirmed before a full BVN is sent and needs the `identity` approval with live keys. `bvn` values are redacted from output |
| **Code** | `src/tools/verification.ts`, `src/config/toolSafety.ts`, `src/utils/redact.ts` |
| **Tests** | `securityReview.test.ts` (no identity value in any output for a full record; no answer before consent; confirmation before sending) |
| **Remains** | The BVN itself is still typed into the chat to start a check |

### 4. Duplicate payments on retry

| | |
|---|---|
| **Threat** | A create times out or returns 503 but succeeds, and the AI retries. We saw this in the sandbox on 3 Nov 2026 |
| **Controls** | Every create gets a unique reference. v4 sends it as `X-Idempotency-Key`. A timeout, a 5xx or a reply without an ID counts as uncertain. The server then looks the record up by reference with backoff, and retries once with the same key only when nothing exists. Creates with no lookup return `unknown` and never retry. v3 does the same (#18) for charges (lookup: `/transactions/verify_by_reference?tx_ref=`), transfers and stablecoin sends (`/transfers?reference=`) and bill payments (`/bills/{reference}/status`). A v3 4xx is a clear failure: no lookup, no retry |
| **Code** | `src/utils/reference.ts`, `src/tools/v4/safeCreate.ts`, `src/client/v4/http.ts` (#8); `src/tools/safeCreateV3.ts`, `src/client/lib/` (#18) |
| **Tests** | `safeCreate.test.ts`: per create tool, a fault with the record existing gives one record; a fault with no record gives one retry with the same key. Also the fault switch. `reference.test.ts`. A sandbox run with `FLW_FAULT=503_no_id` found the real record. `safeCreateV3.test.ts`: the same cases for v3 transfers and charges, plus a 4xx with no retry. Contract tests (#21), against the real sandboxes: a retried create with a fixed reference leaves one record (v4 virtual account, v3 transfer) |
| **Remains** | v3 has no idempotency header, so the lookup is the only guard. Other v3 creates have no lookup by reference and still return `unknown` with guidance only. The v3 lookups have not yet been run against the live sandbox. Lookups for orders and transfers scan recent pages, because those list endpoints have no reference filter |

### 5. Forged or replayed webhooks

| | |
|---|---|
| **Threat** | Someone posts a fake "payment successful" webhook, or replays a real one |
| **Controls** | `verify_webhook` checks v3 `verif-hash` and the v4 `flutterwave-signature` (base64 HMAC-SHA256 of the raw body). The comparison is constant time over SHA-256 digests. A bad signature stops before parsing. The status is then fetched from the API, so the webhook's own status is never trusted. A repeated body is flagged and never "safe" |
| **Code** | `src/tools/webhook.ts` (#13) |
| **Tests** | `webhook.test.ts`: 10 real v3 Test Mode payloads and one production-shaped synthetic payload; wrong, longer and missing signatures; v4 HMAC with a changed body; replay; the API status winning over the webhook |
| **Remains** | v3 is also checked against a synthetic payload in the exact shape of a real production delivery (a failed card attempt on hosted checkout, 2026-11-22; RFC item 6.5). v4 parsing follows the docs only, because no real v4 webhook has been captured yet. The sandbox sends no transfer webhook unless the transfer uses a scenario (#20), which explains the earlier gap; capture is the next step. Replay detection is per process, with no timestamp window. Dashboard resends are byte-identical, so they cannot be told apart from replays |

### 6. Giving value on an unconfirmed payment

| | |
|---|---|
| **Threat** | Goods are shipped or a wallet is credited on a pending, partial, wrong-currency or reversed payment |
| **Controls** | `verify_payment` returns `safe_to_give_value` only when the status is successful, the amount is at least the amount expected, and the currency and reference match. `verify_payout` is safe only on a final `SUCCESSFUL` with no reversal. There are separate v3 and v4 status maps with exact matching, and anything unlisted is `unknown`, never success. Every result names its environment. Create and webhook tools point to the verify tools |
| **Code** | `src/verify/statusMaps.ts`, `src/verify/environment.ts`, `src/tools/verify.ts`, `src/tools/policy.ts` (#9) |
| **Tests** | `verify.test.ts`: every known value per version; `candidateSpecStatus.test.ts`: every candidate-spec enum value; 13 unknown values; one case per mismatch; reversal after success |
| **Remains** | The v3 maps now cover every value in the candidate V3 spec's status enums (`michaelrowlandftw/flutterwave-v3-openapi` 0.1.0-candidate+20261122), built from measured Test Mode and production responses; `candidateSpecStatus.test.ts` replays them (RFC item 6.6). Enums stay open: an unlisted value is `unknown`. v4 values are still from the docs only |

### 7. Dependency risk

| | |
|---|---|
| **Threat** | A vulnerable or unneeded package in the runtime |
| **Controls** | Removed 4 unused packages (`flutterwave-node-v3`, `colors`, `ts-node`, `nodemon`). Removed the demo web app and its packages (`express`, `@types/express`, `@anthropic-ai/sdk`). Updated the MCP SDK to 1.32.2. Upgraded `zod` to 4.x (#17), which fixes GHSA-mrhx-c7xc-m3w5; the SDK accepts zod 3 or 4. Same-major `overrides` for patched `fast-uri`, `ip-address`, `body-parser` and `hono`. CI runs on every PR: tests and build on Node 22 and 24, plus `npm audit` (blocking on critical runtime advisories) |
| **Code** | `package.json`, `package-lock.json`, `.github/workflows/ci.yml` (#15, #17) |
| **Tests** | CI; `npm ci` works from the lock file (npm 11) |
| **Remains** | None. `npm audit --omit=dev` reports 0 vulnerabilities (12 Nov 2026, after #17). 28 advisories were found at the start (12 Nov 2026) |

### 8. A tampered release

| | |
|---|---|
| **Threat** | A changed package or image reaches users: a stolen publish token, a push that skips review, an unsigned image |
| **Controls** | npm trusted publishing (OIDC, no stored token, provenance); no workflow pushes to `main`; image SBOM, SLSA provenance and a keyless cosign signature; actions pinned by SHA; CODEOWNERS |
| **Code** | `.github/workflows/publish.yml`, `.github/workflows/docker.yml`, `.github/CODEOWNERS`; [release.md](release.md) |
| **Tests** | `actionlint` clean. The release workflows have not run yet |
| **Remains** | Branch protection, the tag ruleset and the npm trusted-publisher setting must be set by an admin. A full pen test (Security) |

## Other controls

- **Usage tag:** every API call sends `User-Agent: mcp-flutterwave/<version>` and a fresh `X-Trace-Id`. They hold no customer data (#14).
- **Test fault switch:** `FLW_FAULT` works only against the v4 sandbox and is ignored elsewhere (#8).
- **Sandbox scenarios:** `get_sandbox_scenarios` lists documented test scenarios without card numbers. v4 charge, order and transfer tools accept `sandbox_scenario`, validated against the documented key shape and sent as `X-Scenario-Key` to the sandbox host only (#20).
- **Contract tests:** `npm run test:contract` checks the server against the real sandboxes when sandbox credentials are set (#21). CI skips them until the credentials are repository secrets.
- **Timeouts:** v4 calls time out after 60 seconds (`FLW_TIMEOUT_MS`), so a hung call becomes an "unknown" result, not a silent wait (#8).

## Independent reviews (13 Nov 2026)

Two independent review rounds were run on the code (no access to our own notes).

- **First round:** 4 high, 5 medium and 7 low findings.
- **Second round** (checking the fixes): one regression and 10 further issues. The worst was a confirmation token replay with leading zeros.
- **Status:** every finding from both rounds is fixed in #22. Each fix has a test, and the contract tests pass against the sandboxes.
- **Before live mode is switched back on:**
  - keep elicitation required (the code already does this for live);
  - set a cap for every currency used;
  - set `FLW_ALLOWED_URL_HOSTS`;
  - replace in-memory replay and token stores with a shared store if more than one server instance runs.

## Open items

1. **Pen test**: Security to arrange before the first official release.
2. **GitHub and npm settings**: an admin applies [release.md](release.md) (branch protection, tag ruleset, npm trusted publisher, delete `NPM_TOKEN`).
3. **Tokenised charges**: verify in Test Mode that a card saved from a 3DS checkout can be charged by token, that the charge answers with a 3DS redirect by default, and how customer-not-present enablement shows.
4. **Live mode sign-off**: Security reviews this branch's conditions, then `LIVE_MODE_APPROVED` is switched on in a separate, reviewed change.
5. **Hosted OAuth**: its own RFC, review and security test (decision 8).
6. **Upstream**: these changes are on the fork. Abraham's upstream (`bajoski34/mcp-flutterwave`) has its own v4 line and none of the v2.0.0 controls; the two are reconciled before any upstream release.
