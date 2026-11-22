# mcp-flutterwave

[![CI](https://github.com/bajoski34/mcp-flutterwave/actions/workflows/ci.yml/badge.svg)](https://github.com/bajoski34/mcp-flutterwave/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mcp-flutterwave.svg)](https://www.npmjs.com/package/mcp-flutterwave)
[![npm downloads](https://img.shields.io/npm/dm/mcp-flutterwave.svg)](https://www.npmjs.com/package/mcp-flutterwave)
[![Docker](https://img.shields.io/badge/ghcr.io-mcp--flutterwave-blue?logo=docker)](https://github.com/bajoski34/mcp-flutterwave/pkgs/container/mcp-flutterwave)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/node/v/mcp-flutterwave.svg)](https://www.npmjs.com/package/mcp-flutterwave)
[![MCP](https://img.shields.io/badge/MCP-compatible-blue.svg)](https://modelcontextprotocol.io)

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that enables AI assistants to interact with the Flutterwave API: create payment links, charge saved cards, bank accounts and mobile money, manage transfers, collect via virtual accounts, pay bills, and more. Card numbers never pass through the AI model.

> **Note:** The server targets the Flutterwave v4 API by default. Set `FLW_API_VERSION=v3` to register the v3 tool set instead. An existing install that sets only `FLW_SECRET_KEY` (no `FLW_CLIENT_ID`) stays on v3 and prints a warning. A process registers one version at a time.

## What is and is not supported

Decided with Flutterwave Security (review of DX-RFC-001, 2026-11-17; adopted 2026-11-22). Card handling matches Stripe's and Paystack's MCP servers: no raw card data goes through the model.

| Capability | Status | How |
|---|---|---|
| Card payments by hosted checkout | ✅ Default | `create_checkout` (v3), `create_order` (v4). The customer enters the card on Flutterwave's page, which runs 3D Secure |
| Tokenised charge of a card saved from a 3DS checkout | ✅ Customer present | `charge_tokenized_card` (v3), `create_charge` with a saved `payment_method_id` (v4). By default every tokenised charge runs 3D Secure, so expect a redirect the customer must complete |
| Tokenised charge without the customer present (recurring, merchant-initiated) | ⚠️ Only once Flutterwave enables it | Needs Flutterwave's approval and enablement on the merchant account |
| Direct Charge (card number, CVV or PIN through the API) | ❌ Not available | It needs Flutterwave's approval and puts the merchant in PCI DSS scope. Approved merchants build it in their own backend, not through this server |
| Bank account, mobile money, M-Pesa, USSD charges | ✅ | `charge_bank_account`, `charge_mobile_money`, `charge_mpesa`, `charge_ussd` (v3) |
| BVN | ✅ Restricted | `initiate_bvn_verification` asks for confirmation before a BVN is sent; `get_bvn_details` answers match / no-match only, with no identity data |
| Live mode | ⛔ Off until Security approves | The conditions are built in and checked at start-up: see [Live mode](#live-mode) and [docs/security.md](docs/security.md) |

The two tokenised-charge rules (3D Secure on every charge by default; customer-not-present needs enablement) are Flutterwave's stated behaviour and are **still to be verified** with a Test Mode tokenised charge of a card saved from a 3DS checkout. Nothing here is assumed from the docs alone.

---

## Contents

- [Features](#features)
- [Installation](#installation)
- [Available Tools](#available-tools)
- [Flutterwave v4](#flutterwave-v4)
- [Card payments](#card-payments)
- [Virtual Accounts](#virtual-accounts)
- [Bill Payment Flow](#bill-payment-flow)
- [FX Trade Flow](#fx-trade-flow)
- [Verification](#verification)
- [Stablecoins](#stablecoins)
- [MCP Server Setup](#mcp-server-setup)
- [Usage with Claude Desktop](#usage-with-claude-desktop)
- [MCP-UI Components](#mcp-ui-components)
- [Contributing](#contributing)
- [Changelog](#changelog)
- [Security](#security)
- [License](#license)

---

## Features

- **Checkout** — Create hosted payment links and disable them
- **Charges** — Charge a card saved from a 3DS checkout (tokenised), a bank account, mobile money, M-Pesa or USSD. No card numbers, CVVs or PINs
- **Charge Validation** — Validate OTP-based charges with a dedicated tool
- **Transactions** — Verify by ID or reference, view event timeline, resend failed webhooks
- **Transfers** — Initiate single transfers, manage beneficiaries
- **Payment Plans** — Create and retrieve subscription plans
- **Virtual Accounts** — Generate dedicated account numbers for NGN and GHS bank transfer collection (static or dynamic)
- **Bill Payments** — Pay airtime, data, cable TV, electricity, internet bills and more (Nigeria)
- **FX Trade** — Convert between NGN, GHS, and USD with live quotes (RFQ → trade in two steps)
- **Verification** — BVN match / no-match checks, bank account name resolution, and card BIN lookup
- **Stablecoins** — Send USDC/USDT to Polygon wallets, or convert NGN/USD fiat into stablecoins
- **Rich UI** — Every tool returns a branded HTML card rendered inline in supported clients

---

## Installation

### npm

```bash
npm install -g mcp-flutterwave
```

### npx (no install needed)

```bash
npx mcp-flutterwave --tools=all --read-only
```

Start read-only, then drop `--read-only` (in test mode) when you want write tools.

### Docker

Pull the image:

```bash
docker pull ghcr.io/bajoski34/mcp-flutterwave:latest
```

The server communicates over stdio, so it must be launched by an MCP client — not run standalone. Configure Claude Desktop to use the Docker image as the MCP server:

```json
{
  "mcpServers": {
    "flutterwave": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "FLW_API_VERSION=v3",
        "-e", "FLW_SECRET_KEY=YOUR_TEST_SECRET_KEY",
        "ghcr.io/bajoski34/mcp-flutterwave:latest"
      ]
    }
  }
}
```

The `-i` flag keeps stdin open so Claude Desktop can communicate with the server over stdio. The image starts with `--tools=all --read-only`. For v4 (the default), pass `FLW_CLIENT_ID` and `FLW_CLIENT_SECRET` instead of the v3 secret key. See [Flutterwave v4](#flutterwave-v4).

**Requirements:** Node.js 22 or later (for npm/npx).

### Live mode

Live mode is disabled until Security approves it. The server refuses live credentials at start-up (v3: `FLW_SECRET_KEY` must start with `FLWSECK_TEST`; v4: `FLW_ENVIRONMENT=production` is refused), and no flag or environment variable turns it on.

The conditions Security set are already enforced, so the refusal lists what a live setup still lacks. With live keys:

- each tool is listed in `--tools` (no `--tools=all`);
- keys come from the OS keychain (`FLW_KEY_SOURCE=keychain`; `FLW_KEY_SOURCE=env` is an explicit opt-out);
- the server is read-only unless `--read-only=false` is on the command line;
- each money-moving category is approved separately in `FLW_LIVE_APPROVED_CATEGORIES` (`collections`, `payouts`, `refunds`, `disputes`, `bills`, `fx`, and `identity` for the BVN consent tool);
- every currency used has its own cap, `FLW_MAX_AMOUNT_<CURRENCY>` (`FLW_MAX_AMOUNT` alone is not enough);
- confirmation can't be switched off (`FLW_CONFIRM=false` is refused) and money tools need a client that asks the person (MCP elicitation);
- `FLW_ALLOWED_URL_HOSTS` is set.

The server runs over stdio, one process per person, so the in-memory stores for confirmation tokens and webhook replays hold. A hosted, multi-instance server needs shared stores and is part of the hosted-OAuth RFC.

### Safety settings

| Setting | What it does |
|---|---|
| `FLW_KEY_SOURCE=keychain` | Reads `FLW_SECRET_KEY`, `FLW_CLIENT_ID`, `FLW_CLIENT_SECRET` and `FLW_SECRET_HASH` from the OS keychain (service `mcp-flutterwave`). See [docs/security.md](docs/security.md#key-storage) |
| `FLW_LIVE_APPROVED_CATEGORIES` | Live mode only: the money-moving categories approved for use |
| `FLW_ENV_FILE=/path/to/file` | Loads credentials from that file. A `.env` in the working folder is **not** read, and safety switches in a file are ignored |
| `FLW_REQUIRE_ELICITATION=true` | Blocks money-moving tools in AI clients that can't ask you to confirm directly (always on with live credentials) |
| `FLW_MAX_AMOUNT`, `FLW_MAX_AMOUNT_<CURRENCY>` | Amount caps. With a cap set, calls whose amount or currency can't be read are refused, and so are tools that move money with no amount of their own (`retry_transfer`, `update_transfer`, `initiate_fx_trade`) |
| `FLW_ALLOWED_URL_HOSTS=a.com,b.com` | Only these hosts are allowed in `callback_url` and `redirect_url` |
| `FLW_TIMEOUT_MS` | API timeout (default 60 seconds); a timed-out create returns `unknown` |

`callback_url` and `redirect_url` must be https (`http://localhost` is allowed in test mode). A `pin` field in any tool's input is refused.

### Read-only mode

`--read-only` (or `FLW_READ_ONLY=true`) registers only tools that read data: `get_`, `list_`, `read_`, `resolve_` and `verify_` tools, and a few checks and quotes. Read-only mode is off by default in test mode and on by default with live keys. Naming a write tool in `--tools` while read-only mode is on stops start-up with an error.

### Confirmation and amount cap on money-moving tools

Tools that move money (charges, transfers, refunds, bills, FX, stablecoins, and updates that can void or cancel) never run on the first call. Neither does `initiate_bvn_verification`, which sends a full BVN.

- If the MCP client supports elicitation, the server asks the user to confirm a summary directly.
- Otherwise the first call returns the summary and a `confirmation_token`. The tool runs only when called again with exactly the same arguments plus that token. Tokens are bound to the tool and its arguments, work once, and expire after 5 minutes.
- `FLW_MAX_AMOUNT` (any currency) and `FLW_MAX_AMOUNT_<CURRENCY>` (for example `FLW_MAX_AMOUNT_NGN=50000`) refuse larger amounts before anything is sent.
- `FLW_CONFIRM=false` turns confirmation off for automated sandbox tests.

### No card data through the AI model

The raw card tools were removed from the package: v3 `charge_card`, v4 `create_card_payment_method`, `create_orchestrator_charge` and `create_orchestrator_order`, and the PIN path of `update_charge`. Passing `--enable-raw-card-tools` or setting `FLW_ENABLE_RAW_CARD_TOOLS` stops start-up with an explanation. Card numbers in any output are still redacted, as defence in depth. Use hosted checkout or a tokenised charge (see [What is and is not supported](#what-is-and-is-not-supported)).

---

## Docs guide

The server gives the AI a guide to the Flutterwave docs, so it can help write integration code:

- Resource `flutterwave://docs/guide`: links to [llms.txt](https://developer.flutterwave.com/llms.txt), the full docs in Markdown, the OpenAPI spec, key pages (testing, webhooks, idempotency) and the official SDKs on GitHub.
- Prompt `flutterwave_integration_help`: loads the same guide into the chat.
- Server instructions tell the AI where the guide is.

## Available Tools

### Checkout
| Tool | Description |
|---|---|
| `create_checkout` | Create a hosted Flutterwave payment link |
| `disable_checkout` | Disable an existing payment link |

### Charges
| Tool | Description |
|---|---|
| `charge_tokenized_card` | Charge a card saved from an earlier 3DS checkout payment, by its token. Runs 3D Secure by default: the customer must be present |
| `charge_bank_account` | Debit a bank account (NGN / GHS) |
| `charge_mobile_money` | Mobile money — Ghana, Uganda, Rwanda, Zambia, Francophone Africa |
| `charge_mpesa` | M-Pesa charge (KES) |
| `charge_ussd` | USSD charge (NGN) |
| `validate_charge` | Validate a pending bank account charge using OTP |

### Transactions
| Tool | Description |
|---|---|
| `read_transaction` | Get transaction details by ID |
| `read_transaction_with_reference` | Get transaction details by `tx_ref` |
| `read_transaction_timeline` | View the event timeline for a transaction |
| `resend_transaction_webhook` | Resend a failed webhook |

### Transfers
| Tool | Description |
|---|---|
| `create_transfer` | Initiate a bank transfer |
| `create_beneficiary` | Save a new transfer beneficiary |
| `list_beneficiaries` | List all saved beneficiaries |

### Payment Plans
| Tool | Description |
|---|---|
| `create_payment_plan` | Create a recurring payment plan |
| `get_payment_plans` | List payment plans with optional filters |

### Virtual Accounts
| Tool | Description |
|---|---|
| `create_virtual_account` | Create a dedicated bank account number for a customer (NGN or GHS) |
| `get_virtual_account` | Retrieve a virtual account's status and details by `order_ref` |
| `update_virtual_account` | Link or update the BVN on an NGN virtual account |
| `list_virtual_account_bulk` | List all accounts created in a bulk batch |

### Bill Payments
| Tool | Description |
|---|---|
| `get_bill_categories` | List available bill categories (AIRTIME, CABLEBILLS, UTILITYBILLS, etc.) |
| `get_bill_providers` | List billers/providers for a category |
| `get_bill_items` | List payable items for a specific biller |
| `validate_bill_customer` | Validate a customer account before payment (meter number, smartcard, etc.) |
| `pay_bill` | Submit a bill payment |
| `get_bill_status` | Check payment status and retrieve prepaid tokens (electricity) |

### FX Trade
| Tool | Description |
|---|---|
| `request_fx_quote` | Submit a Request For Quote (RFQ) for a currency conversion |
| `get_fx_quote` | Poll the quote status — wait for READY before trading |
| `initiate_fx_trade` | Lock in a READY quote and execute the trade |
| `get_fx_trade` | Poll trade status until SETTLED or FAILED |

### Verification
| Tool | Description |
|---|---|
| `initiate_bvn_verification` | Begin a BVN consent request (confirmed first, since it sends a full BVN); returns a single-use consent URL |
| `get_bvn_details` | Compare a completed verification with the names you expect: match / no-match only, no identity data |
| `resolve_bank_account` | Look up the account holder name for a bank account number |
| `verify_card_bin` | Look up card brand, type, issuer, and country from the first 6 digits |

### Stablecoins
| Tool | Description |
|---|---|
| `get_stablecoin_fee` | Get the transfer fee before sending — shows net amount the recipient receives |
| `send_stablecoin` | Send USDC or USDT to a Polygon wallet address |
| `convert_to_stablecoin` | Convert NGN or USD fiat balance into USDC or USDT |

The tables above are the v3 tools. They are what the server registers unless you opt into v4.

---

## Flutterwave v4

v4 is the default. Set `FLW_API_VERSION=v3` to use the v3 tools instead. Installs that set only `FLW_SECRET_KEY` stay on v3. Names that exist in both versions (`create_transfer`, `create_virtual_account`, `get_virtual_account`, `update_virtual_account`, `resolve_bank_account`) call the v4 API in v4 mode.

The v4 tools cover every callable v4 operation in the [developer docs](https://developer.flutterwave.com/llms.txt) (57 operations, checked 12 Nov 2026).

v4 signs in with OAuth client credentials. No v4 tool takes card details: cards are entered on hosted checkout (`create_order`) and charged later by `payment_method_id`. The inbound `refund.completed` webhook is not a tool.

| Variable | Required | Description |
|---|---|---|
| `FLW_API_VERSION` | No | `v4` (default) or `v3` |
| `FLW_CLIENT_ID` | Yes | OAuth client id from Dashboard → Settings → API Keys |
| `FLW_CLIENT_SECRET` | Yes | OAuth client secret from that same view |
| `FLW_ENVIRONMENT` | No | `sandbox` (default) or `production`. `production` is refused: live mode is disabled |

`sandbox` uses `https://developersandbox-api.flutterwave.com`. `production` uses `https://f4bexperience.flutterwave.com`. `FLW_SECRET_KEY` is the v3 credential and is not used in this mode. No encryption key is needed in either version.

**v4 accepted tool names** (`--tools=all` enables every name in this list):

```
create_customer                 create_charge                   get_charge
create_refund                   get_customer                    get_refund
get_payment_method              list_customers                  search_customers
update_customer                 list_charges                    update_charge
list_refunds                    list_payment_methods            get_fees
get_banks                       get_mobile_networks             get_wallet_balance
list_wallet_balances            get_wallet_statement            resolve_wallet_account
list_settlements                get_settlement                  list_chargebacks
get_chargeback                  create_chargeback               update_chargeback
create_order                    get_order                       create_virtual_account
get_virtual_account             quote_transfer_rate             get_transfer_rate
create_orchestrator_transfer    resend_webhook                  get_bank_branches
resolve_bank_account            list_orders                     update_order
list_virtual_accounts           update_virtual_account          list_transfer_recipients
create_transfer_recipient       get_transfer_recipient          delete_transfer_recipient
list_transfer_senders           create_transfer_sender          get_transfer_sender
delete_transfer_sender          create_transfer                 get_transfer
list_transfers                  update_transfer                 retry_transfer
verify_payment                  verify_payout                   verify_webhook
get_sandbox_scenarios
```

---

## Card payments

This server never takes a card number, CVV or PIN. Two paths:

```
1. New card: hosted checkout
   create_checkout (v3) / create_order (v4)
        ↓ customer pays on Flutterwave's page (3D Secure)
   verify_payment(id, expected amount, currency)   ← before giving value
        ↓ the verified transaction carries data.card.token

2. Saved card: tokenised charge
   charge_tokenized_card(token, email, amount, currency, redirect_url)
        ├─ redirect   → send the customer to it (3D Secure, by default on every charge)
        └─ completed  → verify_payment before giving value
```

- A card can be tokenised only after it went through a 3DS checkout payment.
- Charging a saved card with no customer present needs Flutterwave to approve and enable it on the account.
- Both rules are Flutterwave's statements, to be verified in Test Mode.
- The redirect URL is in a different field per rail (`meta.authorization.redirect`, `data.meta.authorization.redirect` or `meta.authorization.redirect_url`); the server reads all three.

---

## Virtual Accounts

Virtual accounts give each customer a dedicated bank account number to make transfers into. Flutterwave notifies your webhook when a payment arrives.

| Feature | NGN | GHS |
|---|---|---|
| Dynamic (one-time) | ✓ — set `amount`, expires in ~1 hr | ✓ — use `frequency` and `duration` |
| Static (reusable) | ✓ — `is_permanent: true`, **BVN required** | ✓ — `is_permanent: true` |
| BVN required | Static accounts only | No |

### NGN static account

```json
{
  "email": "customer@example.com",
  "currency": "NGN",
  "tx_ref": "VA-NGN-001",
  "is_permanent": true,
  "bvn": "22415929481"
}
```

### GHS dynamic account

```json
{
  "email": "customer@example.com",
  "currency": "GHS",
  "tx_ref": "VA-GHS-001",
  "amount": 500,
  "frequency": 5,
  "duration": 7
}
```

After creation, save the `order_ref` — it is the key for retrieving or updating the account via `get_virtual_account` and `update_virtual_account`.

---

## Bill Payment Flow

Bill payments follow a 6-step discovery flow. Skip `validate_bill_customer` for airtime and mobile data.

```
1. get_bill_categories
        ↓ choose a category (e.g. UTILITYBILLS)

2. get_bill_providers(category)
        ↓ get biller_code (e.g. "BIL127" for IKEDC)

3. get_bill_items(biller_code)
        ↓ get item_code and amount info

4. validate_bill_customer(item_code, customer_id)   ← skip for AIRTIME / MOBILEDATA
        ↓ confirm customer name and details

5. pay_bill(biller_code, item_code, customer_id, amount)
        ↓ returns reference

6. get_bill_status(reference)
        ↓ confirms completion
          for electricity: prepaid token is in extra.token — share it with the customer
```

### Supported categories

| Code | Description |
|---|---|
| `AIRTIME` | Mobile airtime top-up |
| `MOBILEDATA` | Data bundle purchase |
| `CABLEBILLS` | Cable TV (DSTV, GOTV, StarTimes) |
| `INTSERVICE` | Internet service subscriptions |
| `UTILITYBILLS` | Electricity (prepaid & postpaid) |
| `TAX` | Government tax payments |
| `DONATIONS` | Charitable donations |
| `TRANSLOG` | Transport / logistics |
| `DEALPAY` | Deal payments |
| `RELINST` | Religious institutions |
| `SCHPB` | School / education payments |

> Bill payments are available for Nigeria only (`country: NG`).

---

## FX Trade Flow

Currency conversion uses a two-step quote-then-trade flow. Quotes are valid for **5 minutes** and available **weekdays only** (Monday–Friday).

```
1. request_fx_quote(base_currency, target_currency, quantity)
        ↓ returns quote_id, status: NEW

2. get_fx_quote(quote_id)   ← poll until READY or FAILED
        ↓ READY: contains rate, approved_quantity, total_value, expiry

3. initiate_fx_trade(quote_id, narration)
        ↓ locks in rate, returns trade_id, status: NEW

4. get_fx_trade(trade_id)   ← poll until SETTLED or FAILED
        ↓ SETTLED: converted funds credited to target currency wallet instantly
```

### Supported currency pairs

| Pair | Sell | Receive |
|---|---|---|
| NGN/USD | Nigerian Naira | US Dollar |
| GHS/USD | Ghanaian Cedi | US Dollar |
| USD/NGN | US Dollar | Nigerian Naira |

### Quote statuses

| Status | Meaning |
|---|---|
| `NEW` | Quote is being priced |
| `READY` | Rate locked — call `initiate_fx_trade` now |
| `PROCESSING` | A trade has been initiated on this quote |
| `EXPIRED` | 5-minute window passed — submit a new quote |
| `FAILED` | Pair unsupported, minimum not met, or account limit exceeded |

### Trade statuses

| Status | Meaning |
|---|---|
| `NEW` | Trade queued |
| `PENDING` | Executing |
| `SETTLED` | Funds exchanged and credited to target currency wallet |
| `FAILED` | Insufficient balance or processing error |

### Key constraints

- **Minimum trade:** $1,000 USD equivalent in the base currency
- **Quote lifetime:** 5 minutes from issuance (READY state)
- **One-time use:** Each quote can only be used for one trade
- **Approved quantity:** May differ from requested quantity due to liquidity or account limits — always use `approved_quantity` for reconciliation
- **Account enablement:** Contact hi@flutterwavego.com to enable FX trading on your account

---

## Verification

### Bank Account Resolution

Verify a recipient's account details before sending a transfer. Always show the resolved name to the user before proceeding.

```json
{ "account_number": "0690000040", "account_bank": "044" }
```

Common bank codes: `044` Access Bank · `057` Zenith Bank · `058` GTBank · `033` UBA · `011` First Bank

### Card BIN Lookup

Identify card metadata from the first 6 digits of a card number.

```json
{ "bin": "553188" }
// → { brand: "MASTERCARD", type: "CREDIT", issuer: "NEXUS MERCHANT BANK", country: "NIGERIA" }
```

> Card numbers cannot be entered through this server; take card payments on hosted checkout.

### BVN match check (Nigeria)

Kept for support use, in the form Security set: the server never returns BVN identity data.

```
1. initiate_bvn_verification(bvn, firstname, lastname, redirect_url)
        ↓ confirmation first (it sends a full BVN); returns reference + single-use consent URL

2. Customer visits consent URL → approves data sharing on the NIBSS portal

3. get_bvn_details(reference, expected_first_name, expected_last_name, expected_date_of_birth?)
        ↓ { match: true | false | null, fields: { first_name: "match", last_name: "no_match", ... } }
```

> No name, date of birth, phone, NIN, photo or watchlist data leaves the server, in text or a UI card. `match` is null until consent is complete. The record's date-of-birth format is not documented, so a date the server can't read is `not_available`. Needs BVN verification enabled on the Flutterwave account.

---

## Stablecoins

Send USDC or USDT over the **Polygon network**, or convert NGN/USD fiat balances into stablecoins. Always call `get_stablecoin_fee` first so the user knows the net amount the recipient will receive.

### Wallet-to-wallet transfer

```
1. get_stablecoin_fee(amount, currency: "USDT", debit_currency: "USDT")
        ↓ shows fee and net amount

2. send_stablecoin(wallet_address, amount, currency, debit_currency)
        ↓ returns reference and transfer status
```

### Fiat-to-stablecoin conversion

```
1. get_stablecoin_fee(amount, currency: "USDC", debit_currency: "NGN")
        ↓ shows fee (percentage-based) and net USDC amount

2. convert_to_stablecoin(merchant_id, amount, currency, debit_currency: "NGN")
        ↓ deducts NGN from your fiat wallet, credits USDC/USDT
```

### Key constraints

| Constraint | Detail |
|---|---|
| **Network** | Polygon only — no Tron, Solana, or Stellar |
| **Coins** | USDC and USDT |
| **Wallet format** | EVM address: `0x` + 40 hex characters (42 total) |
| **Fiat sources** | NGN or USD for `convert_to_stablecoin`; stablecoin must match `currency` for `send_stablecoin` |
| **Fee type** | Flat fee for same-currency; percentage fee for fiat → stablecoin |

---

## MCP Server Setup

### Via npm

```bash
npm install -g mcp-flutterwave
```

### Via GitHub

```bash
git clone https://github.com/bajoski34/mcp-flutterwave.git
cd mcp-flutterwave
npm install
npm run build
```

Use npm 11 or later to install from the lock file (`npx npm@11 ci`); npm 10 disagrees with the lock file about optional peer packages.

### Contract tests (sandbox)

`npm run test:contract` runs the cases from our API test findings against the real sandboxes: date formats per endpoint, clear errors before bad calls, one record after a retried create, and sandbox transfer scenarios. They are skipped unless these are set (separate names, because the unit-test config sets dummy values for the normal ones):

- `FLW_SANDBOX_CLIENT_ID`, `FLW_SANDBOX_CLIENT_SECRET`: v4 sandbox
- `FLW_SANDBOX_SECRET_KEY`: v3 test key (`FLWSECK_TEST...`); a live key skips the v3 suite
- `FLW_SANDBOX_RECIPIENT_ID` (optional): a sandbox transfer recipient, for the transfer cases

They create sandbox records (a customer, a virtual account, small test transfers). They never run against live.

### Environment variables

v3 (`FLW_API_VERSION=v3`):

| Variable | Required | Description |
|---|---|---|
| `FLW_SECRET_KEY` | Yes | Your Flutterwave secret key |

v4 (default) uses `FLW_CLIENT_ID`, `FLW_CLIENT_SECRET`, and optional `FLW_ENVIRONMENT`. Neither version needs an encryption key. See [Flutterwave v4](#flutterwave-v4).

---

## Usage with Claude Desktop

Add the following to your `claude_desktop_config.json`. See the [MCP quickstart](https://modelcontextprotocol.io/quickstart/user) for details.

Pass `--tools=all` to enable every tool, or a comma-separated list to restrict them. The examples start read-only (`--read-only`); remove it in test mode when you want write tools. With live keys (once approved) list each tool instead of `all`.

### Via npm

```json
{
  "mcpServers": {
    "flutterwave": {
      "command": "mcp-flutterwave",
      "args": ["--tools=all", "--read-only"],
      "env": {
        "FLW_API_VERSION": "v3",
        "FLW_SECRET_KEY": "YOUR_TEST_SECRET_KEY"
      }
    }
  }
}
```

### Via local build

```json
{
  "mcpServers": {
    "flutterwave": {
      "command": "node",
      "args": [
        "/path/to/mcp-flutterwave/build/index.js",
        "--tools=all",
        "--read-only"
      ],
      "env": {
        "FLW_API_VERSION": "v3",
        "FLW_SECRET_KEY": "YOUR_TEST_SECRET_KEY"
      }
    }
  }
}
```

### Selective tools

```json
"args": [
  "--tools=create_checkout,read_transaction,create_transfer"
]
```

**v3 accepted tool names** (`FLW_API_VERSION=v3`; use `all` to enable everything in this list):

```
create_checkout                 disable_checkout                read_transaction
read_transaction_with_reference read_transaction_timeline       resend_transaction_webhook
create_transfer                 create_beneficiary              list_beneficiaries
create_payment_plan             get_payment_plans               charge_tokenized_card
charge_bank_account             charge_mobile_money             charge_mpesa
charge_ussd                     validate_charge                 create_virtual_account
get_virtual_account             update_virtual_account          list_virtual_account_bulk
get_bill_categories             get_bill_providers              get_bill_items
validate_bill_customer          pay_bill                        get_bill_status
request_fx_quote                get_fx_quote                    initiate_fx_trade
get_fx_trade                    initiate_bvn_verification       get_bvn_details
resolve_bank_account            verify_card_bin                 get_stablecoin_fee
send_stablecoin                 convert_to_stablecoin           verify_payment
verify_payout                   verify_webhook                  get_sandbox_scenarios
```

In v4 mode (the default), `--tools=all` enables the [v4 accepted tool names](#flutterwave-v4) instead.

### Via npm (v4)

```json
{
  "mcpServers": {
    "flutterwave": {
      "command": "mcp-flutterwave",
      "args": ["--tools=all", "--read-only"],
      "env": {
        "FLW_API_VERSION": "v4",
        "FLW_CLIENT_ID": "YOUR_CLIENT_ID",
        "FLW_CLIENT_SECRET": "YOUR_CLIENT_SECRET",
        "FLW_ENVIRONMENT": "sandbox"
      }
    }
  }
}
```

---

## MCP-UI Components

Every tool returns a rich HTML card alongside its text response, powered by [@mcp-ui/server](https://www.npmjs.com/package/@mcp-ui/server). The cards use Flutterwave's design tokens — navy `#0A0E27`, deep orange `#FF5804`, brand orange `#F5A623`, and the system sans-serif typeface.

### Charge UI states

| State | Card shown |
|---|---|
| Redirect | 3D Secure, captcha or provider page URL with a direct link |
| OTP required | Bank message, `flw_ref` to pass to `validate_charge` |
| Completed | Amount, status badge, transaction and Flutterwave references |

### Virtual account UI

The virtual account card shows the bank account number in a large, prominent box alongside the bank name, account type (Static / Dynamic), currency, expiry date, and order reference.

### Bill payment UI

| Tool | Card shown |
|---|---|
| `pay_bill` | Bill receipt — biller, item, customer ID, amount, status |
| `get_bill_status` | Status card with prepaid token (electricity) in large monospace text, with a share note |

### Verification UI

The BVN tools return text only, with no card, so no identity data is rendered.

| Tool | Card shown |
|---|---|
| `resolve_bank_account` | Green verified card — account name in large text with account number and bank code |
| `verify_card_bin` | Brand-coloured card (Visa blue / Mastercard red / Amex blue / dark for others) — brand, type badge, issuer, country |

### Stablecoin UI

| Tool | Card shown |
|---|---|
| `get_stablecoin_fee` | Blue-themed fee card — coin pair, flat fee or percentage breakdown, net amount the recipient receives |
| `send_stablecoin` | Transfer card — truncated wallet address, amount, status badge |
| `convert_to_stablecoin` | Conversion card — fiat debit currency, target stablecoin, merchant ID, status |

### FX trade UI

Both `request_fx_quote`/`get_fx_quote` and `initiate_fx_trade`/`get_fx_trade` return dark navy-themed cards:

| State | Card shown |
|---|---|
| Quote NEW / PROCESSING | Instrument badge, status pill, poll instruction |
| Quote READY | Exchange rate, approved quantity, received amount, expiry, call-to-action |
| Quote FAILED / EXPIRED | Error message with reason |
| Trade NEW / PENDING | Amount in target currency, poll instruction |
| Trade SETTLED | Green settled banner, target currency amount, recipient, wallet credit note |
| Trade FAILED | Red failure banner with `response_message` |

Cards are compatible with:

- **MCP Inspector** — for testing during development
- **Any MCP client** that supports the `resource` content type with HTML

---

## Contributing

We welcome contributions! Please read our [Contributing Guide](./CONTRIBUTING.md) for details on how to get started, development guidelines, and how to submit pull requests.

---

## Changelog

All notable changes are documented in [GitHub Releases](https://github.com/bajoski34/mcp-flutterwave/releases).

---

## Security

If you discover a security vulnerability, please **do not** open a public issue. Follow [SECURITY.md](SECURITY.md). How the server protects keys, card data and payments is described in [docs/security.md](docs/security.md).

---

## License

MIT © [Abraham Olaobaju](https://github.com/bajoski34)

See [LICENSE](./LICENSE) for the full text.
