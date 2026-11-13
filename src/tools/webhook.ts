import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { server } from '../server.js';
import { getApiVersion, type ApiVersion } from '../config/apiVersion.js';
import { normaliseStatus } from '../verify/statusMaps.js';
import { verifyPayment, verifyPayout } from './verify.js';

/**
 * A webhook is a signal to check, never the result. verify_webhook:
 * 1. checks the signature: v3 `verif-hash` equals FLW_SECRET_HASH; v4
 *    `flutterwave-signature` equals base64 HMAC-SHA256(raw body, FLW_SECRET_HASH).
 *    Both compared in constant time. A bad signature stops here.
 * 2. reads the ID or reference from every known payload shape, and flags unknown ones.
 * 3. fetches the record from the API and returns its status (payments and payouts).
 * v4 payload handling follows the docs only: no real v4 webhook has been captured yet.
 */

type Json = Record<string, any>;
type Kind = 'payment' | 'payout' | 'refund' | 'bill' | 'unknown';

export type ParsedWebhook = {
  version: ApiVersion;
  shape: string;
  kind: Kind;
  event: string | null;
  id: string | null;
  reference: string | null;
  flw_ref: string | null;
  webhook_status: unknown;
  webhook_status_normalised: string;
  flags: string[];
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  // Compare fixed-length digests, so neither the value nor its length leaks through timing.
  return timingSafeEqual(createHash('sha256').update(x).digest(), createHash('sha256').update(y).digest());
}

function header(headers: Record<string, unknown>, name: string): string | undefined {
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key ? headers[key] : undefined;
  return Array.isArray(value) ? String(value[0]) : value === undefined ? undefined : String(value);
}

export function checkSignature(
  rawBody: string,
  headers: Record<string, unknown>,
  secret: string,
): { valid: boolean; version: ApiVersion | null; reason: string } {
  const v4sig = header(headers, 'flutterwave-signature');
  if (v4sig !== undefined) {
    const expected = createHmac('sha256', secret).update(rawBody).digest('base64');
    return safeEqual(v4sig, expected)
      ? { valid: true, version: 'v4', reason: 'flutterwave-signature matches.' }
      : { valid: false, version: 'v4', reason: 'flutterwave-signature does not match the HMAC of the raw body. Use the exact raw body, not re-serialised JSON.' };
  }
  const v3hash = header(headers, 'verif-hash');
  if (v3hash !== undefined) {
    return safeEqual(v3hash, secret)
      ? { valid: true, version: 'v3', reason: 'verif-hash matches.' }
      : { valid: false, version: 'v3', reason: 'verif-hash does not match the secret hash.' };
  }
  return { valid: false, version: null, reason: 'No verif-hash (v3) or flutterwave-signature (v4) header.' };
}

const str = (v: unknown) => (v === undefined || v === null || v === '' ? null : String(v));

export function parseWebhook(body: Json, version: ApiVersion): ParsedWebhook {
  const base = { version, event: null, id: null, reference: null, flw_ref: null, webhook_status: undefined, flags: [] as string[] };
  const done = (p: Omit<ParsedWebhook, 'webhook_status_normalised'>, object: Parameters<typeof normaliseStatus>[1] | null) => ({
    ...p,
    webhook_status_normalised: object ? normaliseStatus(version, object, p.webhook_status).normalised : 'unknown',
  });

  if (version === 'v4') {
    base.flags.push('v4 payload handling follows the docs; no real v4 webhook has been tested yet.');
    if (typeof body.type === 'string' && body.data && typeof body.data === 'object') {
      const d = body.data as Json;
      const common = { ...base, event: body.type, id: str(d.id), reference: str(d.reference), webhook_status: d.status };
      if (body.type === 'charge.completed') return done({ ...common, shape: 'v4 {type, data}', kind: 'payment' }, 'collection');
      if (body.type === 'transfer.disburse' || body.type === 'transfer.reversal') {
        return done({ ...common, shape: 'v4 {type, data}', kind: 'payout' }, 'payout');
      }
      if (body.type === 'order.authorization') return done({ ...common, shape: 'v4 {type, data}', kind: 'payment' }, 'order');
      common.flags.push(`Unknown v4 event type "${body.type}".`);
      return done({ ...common, shape: 'v4 {type, data}', kind: 'unknown' }, null);
    }
    base.flags.push('Unknown v4 payload shape: expected {type, data}.');
    return done({ ...base, shape: 'unknown', kind: 'unknown' }, null);
  }

  // v3: standard {event, "event.type", data}
  if (typeof body.event === 'string' && body.data && typeof body.data === 'object') {
    const d = body.data as Json;
    const common = { ...base, event: body.event, id: str(d.id), flw_ref: str(d.flw_ref), webhook_status: d.status };
    if (body.event === 'charge.completed') {
      return done({ ...common, shape: 'v3 {event, data}', kind: 'payment', reference: str(d.tx_ref) }, 'collection');
    }
    if (body.event === 'transfer.completed') {
      return done({ ...common, shape: 'v3 {event, data}', kind: 'payout', reference: str(d.reference) }, 'payout');
    }
    if (body.event === 'singlebillpayment.status') {
      return done({ ...common, shape: 'v3 {event, data}', kind: 'bill', reference: str(d.reference ?? d.tx_ref) }, 'collection');
    }
    common.flags.push(`Unknown v3 event "${body.event}".`);
    return done({ ...common, shape: 'v3 {event, data}', kind: 'unknown', reference: str(d.tx_ref ?? d.reference) }, null);
  }

  // v3 refund: flat PascalCase, no event field.
  if ('AmountRefunded' in body && 'FlwRef' in body) {
    base.flags.push(
      'Refund webhook: match the refunded payment on FlwRef. TransactionId is not the ID of the refunded transaction.',
    );
    return done(
      { ...base, shape: 'v3 refund (flat, no event)', kind: 'refund', id: str(body.id), flw_ref: str(body.FlwRef), webhook_status: body.status },
      'refund',
    );
  }

  // v3 legacy flat format ("Enable v3 webhooks" off).
  if (('txRef' in body || 'flwRef' in body) && !('data' in body)) {
    base.flags.push('Legacy webhook format: turn on "Enable v3 webhooks" in the dashboard (Settings, Webhooks).');
    return done(
      {
        ...base,
        shape: 'v3 legacy (v3 webhooks off)',
        kind: 'payment',
        event: str(body['event.type']),
        id: str(body.id),
        reference: str(body.txRef),
        flw_ref: str(body.flwRef),
        webhook_status: body.status,
      },
      'collection',
    );
  }

  base.flags.push('Unknown v3 payload shape. Nothing was fetched.');
  return done({ ...base, shape: 'unknown', kind: 'unknown' }, null);
}

/** Bodies seen in this process, to flag a replayed webhook. */
const seen = new Set<string>();
const SEEN_LIMIT = 10_000;

function remember(digest: string): void {
  seen.add(digest);
  // Keep memory bounded (review L7): drop the oldest entries first.
  // ponytail: per-process and capped; use a shared store with expiry for several server instances.
  if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string);
}

export const VerifyWebhookSchema = {
  raw_body: z.string().min(2).describe('The exact raw request body, as received. Re-serialised JSON breaks the v4 signature.'),
  headers: z.record(z.string(), z.unknown()).describe('The request headers (needs verif-hash or flutterwave-signature).'),
  expected_amount: z.number().positive().optional().describe('For payments: the amount you expect.'),
  expected_currency: z.string().regex(/^[A-Z]{3,5}$/).optional(),
  expected_reference: z.string().min(1).optional().describe('For payments: your tx_ref (v3) or reference (v4).'),
};

type Deps = {
  version?: ApiVersion;
  secret?: string;
  payment?: typeof verifyPayment;
  payout?: typeof verifyPayout;
};

export async function verifyWebhook(
  args: { raw_body: string; headers: Record<string, unknown>; expected_amount?: number; expected_currency?: string; expected_reference?: string },
  deps: Deps = {},
) {
  const secret = deps.secret ?? process.env.FLW_SECRET_HASH;
  if (!secret) throw new Error('Set FLW_SECRET_HASH to the secret hash from the dashboard webhook settings.');
  const out = (value: Json) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

  const signature = checkSignature(args.raw_body, args.headers, secret);
  if (!signature.valid) {
    return out({ signature_valid: false, safe_to_give_value: false, reason: signature.reason, next_step: 'Discard this request. It is not proven to come from Flutterwave.' });
  }

  let body: Json;
  try {
    body = JSON.parse(args.raw_body);
  } catch {
    return out({ signature_valid: true, safe_to_give_value: false, reason: 'The body is not JSON.' });
  }

  const parsed = parseWebhook(body, signature.version!);
  const digest = createHash('sha256').update(args.raw_body).digest('hex');
  const replay = seen.has(digest);
  remember(digest);
  if (replay) parsed.flags.push('This exact webhook was already seen by this server. It may be a retry or a replay; do not give value twice.');

  const serverVersion = deps.version ?? getApiVersion();
  const base = { signature_valid: true, ...parsed, replay_suspected: replay };
  if (parsed.version !== serverVersion) {
    return out({ ...base, safe_to_give_value: false, next_step: `This is a ${parsed.version} webhook but the server runs ${serverVersion}. Check the record with a ${parsed.version} server.` });
  }

  if (parsed.kind === 'payment' && parsed.id) {
    const expected = args.expected_amount !== undefined && args.expected_currency && args.expected_reference;
    const check = await (deps.payment ?? verifyPayment)(
      {
        id: parsed.id,
        expected_amount: args.expected_amount ?? Number.MAX_VALUE,
        expected_currency: args.expected_currency ?? '',
        expected_reference: args.expected_reference ?? '',
      },
      serverVersion,
    );
    const record = JSON.parse(check.content[0].text);
    const apiCheck = expected
      ? record
      : { status: record.status, raw_status: record.raw_status, amount: record.amount, currency: record.currency, reference: record.reference, id: record.id };
    return out({
      ...base,
      api_check: apiCheck,
      safe_to_give_value: expected ? record.safe_to_give_value === true && !replay : false,
      next_step: expected
        ? 'api_check holds the status fetched from the API. Give value only if safe_to_give_value is true.'
        : 'Give expected_amount, expected_currency and expected_reference to get safe_to_give_value, or call verify_payment.',
    });
  }

  if (parsed.kind === 'payout' && (parsed.id || parsed.reference)) {
    const check = await (deps.payout ?? verifyPayout)(
      parsed.id ? { id: parsed.id } : { reference: parsed.reference! },
      serverVersion,
    );
    const record = JSON.parse(check.content[0].text);
    const reversal = parsed.event === 'transfer.reversal' || parsed.webhook_status_normalised === 'reversed';
    if (reversal) parsed.flags.push('Reversal webhook: the money came back. Never give value on it, whatever the API record shows.');
    return out({
      ...base,
      flags: parsed.flags,
      api_check: record,
      safe_to_give_value: record.safe_to_give_value === true && !replay && !reversal,
    });
  }

  return out({
    ...base,
    safe_to_give_value: false,
    next_step:
      parsed.kind === 'refund'
        ? 'Check the refund with the refund or transaction tools, matching on flw_ref.'
        : parsed.kind === 'bill'
          ? 'Check with get_bill_status using the reference.'
          : 'Unknown webhook. Nothing was fetched; check the dashboard webhook settings (all preferences on, v3 webhooks enabled).',
  });
}

export function registerWebhookTools() {
  server.tool(
    'verify_webhook',
    [
      'Check a Flutterwave webhook: verify its signature (v3 verif-hash, v4 flutterwave-signature HMAC), read the ID or reference from any known payload shape, then fetch the record from the API and return its real status.',
      'A webhook is a signal to check, never proof of payment. Needs FLW_SECRET_HASH.',
      'Assumes the default dashboard webhook settings, with every preference on and "Enable v3 webhooks" on; legacy and unknown shapes are flagged.',
      'Webhooks can arrive about 10 minutes after the API call.',
    ].join(' '),
    VerifyWebhookSchema,
    async (args) =>
      verifyWebhook(args).catch((error: unknown) => ({
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
      })),
  );
}
