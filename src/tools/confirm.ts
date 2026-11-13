import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { describeEnvironment } from '../verify/environment.js';
import { redactText } from '../utils/redact.js';

/**
 * Confirmation and amount cap for money-moving tools.
 *
 * 1. Amount cap: FLW_MAX_AMOUNT (any currency) and FLW_MAX_AMOUNT_<CUR>
 *    (for example FLW_MAX_AMOUNT_NGN) refuse a call above the cap.
 * 2. Confirmation: when the client supports MCP elicitation, the user is asked
 *    directly. Otherwise the first call returns a summary and a confirmation
 *    token; the call runs only when repeated with the same arguments and that
 *    token. Tokens are bound to the tool and arguments, single use, and expire
 *    after 5 minutes.
 * FLW_CONFIRM=false turns confirmation off (for automated sandbox tests).
 *
 * The token flow lets the AI relay the person's "yes", so it proves the details
 * were shown, not that a person approved them. It is a test-mode convenience:
 * against live, or with FLW_REQUIRE_ELICITATION=true, money tools need a client
 * that asks the person directly (MCP elicitation).
 */

const TOKEN_TTL_MS = 5 * 60_000;
const secret = randomBytes(32);
const usedTokens = new Set<string>();

type Args = Record<string, unknown>;
type Result = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** JSON with sorted keys, so the same arguments always give the same text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Args)
      .sort()
      .filter((k) => (value as Args)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Args)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function sign(tool: string, args: Args, expires: number): string {
  return createHmac('sha256', secret).update(`${tool}\n${canonical(args)}\n${expires}`).digest('hex');
}

export function issueToken(tool: string, args: Args, now = Date.now()): string {
  const expires = now + TOKEN_TTL_MS;
  return `${expires}.${sign(tool, args, expires)}`;
}

/** Exact token format. Anything else (extra parts, upper case, trailing text) is refused. */
const TOKEN_FORMAT = /^(\d{1,16})\.([0-9a-f]{64})$/;

export function checkToken(tool: string, args: Args, token: string, now = Date.now()): string | null {
  const match = TOKEN_FORMAT.exec(token);
  if (!match) return 'The confirmation token is not valid.';
  const expires = Number(match[1]);
  if (now > expires) return 'The confirmation token has expired. Ask the user again.';
  const expected = Buffer.from(sign(tool, args, expires), 'hex');
  const given = Buffer.from(match[2], 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'The confirmation token does not match this tool and these arguments. Ask the user to confirm the new details.';
  }
  // The format is exact, so the token string is its own canonical form.
  if (usedTokens.has(token)) return 'The confirmation token was already used.';
  usedTokens.add(token);
  // ponytail: used tokens are kept until restart; they expire after 5 minutes, prune if memory matters.
  return null;
}

/**
 * Money tools that carry no amount of their own. Their amount was set, and capped,
 * when the payment or quote was created: validate and update calls act on an
 * existing payment; initiate_fx_trade uses a quote from request_fx_quote, whose
 * quantity is capped.
 */
export const NO_AMOUNT_TOOLS = new Set([
  'validate_charge', 'update_charge', 'update_order', 'update_transfer', 'update_chargeback', 'retry_transfer', 'initiate_fx_trade',
]);

type Raw = { amount?: unknown; currency?: unknown };

/** Where each tool keeps its amount and currency. */
function rawAmount(tool: string, args: Args): Raw {
  const pi = args.payment_instruction as Args | undefined;
  if (pi) {
    const amount = pi.amount as Args | undefined;
    const currency = amount?.applies_to === 'destination_currency' ? pi.destination_currency : pi.source_currency;
    return { amount: amount?.value, currency };
  }
  if (tool === 'request_fx_quote') return { amount: args.quantity, currency: args.base_currency };
  if (tool === 'pay_bill') return { amount: args.amount, currency: 'NGN' }; // bills are Nigeria only
  return { amount: args.amount, currency: args.currency ?? args.debit_currency };
}

function parseAmount(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim())) return Number(value);
  return undefined;
}

/** Amount and currency in a tool's arguments. amount is undefined when it can't be read. */
export function amountOf(args: Args, tool = ''): { amount?: number; currency?: string } {
  const raw = rawAmount(tool, args);
  return {
    amount: parseAmount(raw.amount),
    currency: typeof raw.currency === 'string' && raw.currency !== '' ? raw.currency.toUpperCase() : undefined,
  };
}

export function isLive(env: NodeJS.ProcessEnv = process.env): boolean {
  const e = describeEnvironment(env).environment;
  return e === 'production' || e === 'live';
}

/**
 * The amount cap. Refuses an amount above the cap, and also refuses when a cap is
 * set but the amount or its currency can't be read. With live credentials a cap is required.
 */
export function capError(args: Args, env: NodeJS.ProcessEnv = process.env, tool = ''): string | null {
  if (NO_AMOUNT_TOOLS.has(tool)) return null;
  const general = env.FLW_MAX_AMOUNT;
  const anyCurrencyCap = Object.keys(env).some((k) => /^FLW_MAX_AMOUNT_[A-Z]{3,5}$/.test(k) && !!env[k]);
  if (!general && !anyCurrencyCap) {
    return isLive(env)
      ? 'Live mode needs an amount cap: set FLW_MAX_AMOUNT (and FLW_MAX_AMOUNT_<CURRENCY> if needed). The call was not sent.'
      : null;
  }
  const raw = rawAmount(tool, args);
  const { amount, currency } = amountOf(args, tool);
  if (raw.amount !== undefined && amount === undefined) {
    return `The amount ${JSON.stringify(raw.amount)} is not a plain number (digits and an optional decimal point), so the amount cap can't be checked. The call was not sent.`;
  }
  if (amount === undefined) {
    return "This call has no amount the server can read, so the amount cap can't be checked. The call was not sent.";
  }
  const perCurrencyName = currency ? `FLW_MAX_AMOUNT_${currency}` : undefined;
  const perCurrency = perCurrencyName ? env[perCurrencyName] : undefined;
  const capText = perCurrency ?? general;
  if (!capText) {
    // Only per-currency caps are set. A known currency without a cap passes; an unknown one does not.
    return currency
      ? null
      : "The currency of this call can't be read and only per-currency caps are set. Set FLW_MAX_AMOUNT too. The call was not sent.";
  }
  const cap = Number(capText);
  const source = perCurrency ? perCurrencyName : 'FLW_MAX_AMOUNT';
  if (!Number.isFinite(cap)) return `${source} is not a number. The call was not sent.`;
  return amount > cap
    ? `Amount ${amount}${currency ? ` ${currency}` : ''} is above the cap of ${cap} set by ${source}. The call was not sent.`
    : null;
}

export function confirmationRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLW_CONFIRM !== 'false';
}

const text = (value: unknown, isError = false): Result => ({
  content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

/** Wrap a money-moving tool handler with the cap and the confirmation step. */
export function guardMoneyTool(
  server: McpServer,
  name: string,
  handler: (args: Args, extra: unknown) => Promise<unknown>,
) {
  return async (rawArgs: Args, extra: unknown) => {
    const { confirmation_token: token, ...args } = rawArgs ?? {};
    const cap = capError(args, process.env, name);
    if (cap) return text(cap, true);
    const live = isLive();
    if (!live && !confirmationRequired()) return handler(args, extra);

    const summary = { tool: name, arguments: args };
    const canAsk = !!server.server.getClientCapabilities()?.elicitation;
    if (!canAsk && (live || process.env.FLW_REQUIRE_ELICITATION === 'true')) {
      return text(
        {
          status: 'not_sent',
          reason:
            'This AI client cannot ask you to confirm directly (MCP elicitation), so money-moving tools are blocked. Use a client that supports elicitation.',
        },
        true,
      );
    }
    if (canAsk) {
      const answer = await server.server.elicitInput({
        // Redacted: the person sees the details, but not card data or secrets.
        message: `Confirm this Flutterwave action:\n${redactText(JSON.stringify(summary, null, 2))}`,
        requestedSchema: {
          type: 'object',
          properties: { confirm: { type: 'boolean', title: 'Yes, do this' } },
          required: ['confirm'],
        },
      });
      if (answer.action === 'accept' && (answer.content as Args | undefined)?.confirm === true) {
        return handler(args, extra);
      }
      return text({ status: 'not_sent', reason: 'The user did not confirm.' });
    }

    if (typeof token !== 'string') {
      return text({
        status: 'confirmation_required',
        summary,
        confirmation_token: issueToken(name, args),
        next_step:
          'Show this summary to the user and ask them to confirm. Only if they say yes, call the same tool again with exactly the same arguments plus confirmation_token. The token expires in 5 minutes and works once.',
      });
    }
    const problem = checkToken(name, args, token);
    if (problem) return text({ status: 'not_sent', reason: problem }, true);
    return handler(args, extra);
  };
}
