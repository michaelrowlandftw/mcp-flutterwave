import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

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

export function checkToken(tool: string, args: Args, token: string, now = Date.now()): string | null {
  const [expiresText, mac] = token.split('.');
  const expires = Number(expiresText);
  if (!mac || !Number.isFinite(expires)) return 'The confirmation token is not valid.';
  if (now > expires) return 'The confirmation token has expired. Ask the user again.';
  const expected = Buffer.from(sign(tool, args, expires), 'hex');
  const given = Buffer.from(mac, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return 'The confirmation token does not match this tool and these arguments. Ask the user to confirm the new details.';
  }
  if (usedTokens.has(token)) return 'The confirmation token was already used.';
  usedTokens.add(token);
  return null;
}

/** Amount and currency in a tool's arguments, wherever the tool keeps them. */
export function amountOf(args: Args): { amount?: number; currency?: string } {
  const pi = args.payment_instruction as Args | undefined;
  const raw =
    args.amount ??
    (pi?.amount as Args | undefined)?.value ??
    (pi?.amount as unknown);
  const amount = typeof raw === 'number' ? raw : typeof raw === 'string' && raw !== '' ? Number(raw) : undefined;
  const currency = (args.currency ?? args.debit_currency ?? pi?.source_currency) as string | undefined;
  return { amount: Number.isFinite(amount) ? amount : undefined, currency };
}

export function capError(args: Args, env: NodeJS.ProcessEnv = process.env): string | null {
  const { amount, currency } = amountOf(args);
  if (amount === undefined) return null;
  const perCurrency = currency ? env[`FLW_MAX_AMOUNT_${currency.toUpperCase()}`] : undefined;
  const capText = perCurrency ?? env.FLW_MAX_AMOUNT;
  if (!capText) return null;
  const cap = Number(capText);
  if (!Number.isFinite(cap)) return null;
  return amount > cap
    ? `Amount ${amount}${currency ? ` ${currency}` : ''} is above the cap of ${cap} set by ${perCurrency ? `FLW_MAX_AMOUNT_${currency!.toUpperCase()}` : 'FLW_MAX_AMOUNT'}. The call was not sent.`
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
    const cap = capError(args);
    if (cap) return text(cap, true);
    if (!confirmationRequired()) return handler(args, extra);

    const summary = { tool: name, arguments: args };
    if (server.server.getClientCapabilities()?.elicitation) {
      const answer = await server.server.elicitInput({
        message: `Confirm this Flutterwave action:\n${JSON.stringify(summary, null, 2)}`,
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
