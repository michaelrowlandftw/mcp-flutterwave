import { z } from 'zod';
import { server } from '../server.js';
import { getApiVersion, type ApiVersion } from '../config/apiVersion.js';
import { assertSafePath, flwV4Fetch } from '../client/v4/http.js';
import { lookupTransfer } from './v4/safeCreate.js';
import { normaliseStatus, type StatusObject } from '../verify/statusMaps.js';
import { describeEnvironment } from '../verify/environment.js';
import { setUsageHeaders } from '../config/userAgent.js';

type Record_ = Record<string, unknown>;
type Fetcher = (path: string) => Promise<Record_ | null>;

const V3_BASE = 'https://api.flutterwave.com/v3';

/** GET a v3 record. Returns data, or null on 404. */
const v3Get: Fetcher = async (path) => {
  assertSafePath(path);
  const response = await fetch(`${V3_BASE}${path}`, {
    headers: setUsageHeaders(new Headers({ Authorization: `Bearer ${process.env.FLW_SECRET_KEY}` })),
    signal: AbortSignal.timeout(60_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Flutterwave v3 GET ${path} failed: ${response.status}`);
  return ((await response.json()) as { data?: Record_ }).data ?? null;
};

/** GET a v4 record. Returns data, or null on 404. */
const v4Get: Fetcher = async (path) => {
  const response = await flwV4Fetch(path, { method: 'GET' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Flutterwave v4 GET ${path} failed: ${response.status}`);
  return ((await response.json()) as { data?: Record_ }).data ?? null;
};

function result(value: Record_) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN);

export const VerifyPaymentSchema = {
  id: z.string().min(1).describe('Transaction ID (v3) or charge ID chg_… / order ID ord_… (v4).'),
  expected_amount: z.number().positive().describe('The amount you expect to have received.'),
  expected_currency: z.string().regex(/^[A-Z]{3,5}$/).describe('The currency you expect, for example NGN.'),
  expected_reference: z.string().min(1).describe('Your reference: tx_ref (v3) or reference (v4).'),
};

export async function verifyPayment(
  args: { id: string; expected_amount: number; expected_currency: string; expected_reference: string },
  version: ApiVersion = getApiVersion(),
  get: Fetcher = version === 'v4' ? v4Get : v3Get,
) {
  const isOrder = version === 'v4' && args.id.startsWith('ord');
  const object: StatusObject = isOrder ? 'order' : 'collection';
  const path =
    version === 'v3'
      ? `/transactions/${encodeURIComponent(args.id)}/verify`
      : `/${isOrder ? 'orders' : 'charges'}/${encodeURIComponent(args.id)}`;

  const record = await get(path);
  const reasons: string[] = [];
  if (!record) {
    reasons.push('No payment with this ID was found.');
    return result({ safe_to_give_value: false, reasons, ...describeEnvironment({ ...process.env, FLW_API_VERSION: version }) });
  }

  const status = normaliseStatus(version, object, record.status);
  const amount = num(record.amount);
  const currency = record.currency;
  const reference = version === 'v3' ? record.tx_ref : record.reference;

  if (status.normalised !== 'successful') {
    reasons.push(
      status.normalised === 'unknown'
        ? `Status "${String(record.status)}" is not a known ${version} status. Treat it as pending.`
        : `Status is ${status.normalised} ("${String(record.status)}"), not successful.`,
    );
  }
  if (!(amount >= args.expected_amount)) {
    reasons.push(`Amount ${String(record.amount)} is less than the expected ${args.expected_amount}.`);
  }
  if (currency !== args.expected_currency) {
    reasons.push(`Currency ${String(currency)} does not match the expected ${args.expected_currency}.`);
  }
  if (reference !== args.expected_reference) {
    reasons.push(`Reference ${String(reference)} does not match the expected ${args.expected_reference}.`);
  }

  return result({
    safe_to_give_value: reasons.length === 0,
    reasons: reasons.length ? reasons : ['Status, amount, currency and reference all match.'],
    status: status.normalised,
    raw_status: status.raw,
    amount: record.amount,
    currency,
    reference,
    id: record.id ?? args.id,
    ...describeEnvironment({ ...process.env, FLW_API_VERSION: version }),
  });
}

export const VerifyPayoutSchema = {
  id: z.string().min(1).optional().describe('Transfer ID.'),
  reference: z.string().min(1).optional().describe('Transfer reference (v4 only; v3 needs the ID).'),
};

export async function verifyPayout(
  args: { id?: string; reference?: string },
  version: ApiVersion = getApiVersion(),
  get: Fetcher = version === 'v4' ? v4Get : v3Get,
  byReference: (reference: string) => Promise<unknown> = lookupTransfer,
) {
  if (!args.id && !args.reference) throw new Error('Give a transfer id or reference.');
  if (version === 'v3' && !args.id) throw new Error('v3 needs the transfer id; look it up first.');

  const record = (args.id
    ? await get(`/transfers/${encodeURIComponent(args.id)}`)
    : await byReference(args.reference!)) as Record_ | null;
  const reasons: string[] = [];
  if (!record) {
    reasons.push('No transfer was found.');
    return result({ safe_to_give_value: false, final: false, reasons, ...describeEnvironment({ ...process.env, FLW_API_VERSION: version }) });
  }

  const status = normaliseStatus(version, 'payout', record.status);
  const text = JSON.stringify([record.complete_message, record.reversal, record.events]).toLowerCase();
  const reversed = status.normalised === 'reversed' || text.includes('revers');
  const final = record.status === 'SUCCESSFUL' || record.status === 'FAILED' || record.status === 'CANCELLED' || reversed;

  if (reversed) reasons.push('The transfer was reversed, even if it showed successful before. The money came back.');
  else if (record.status !== 'SUCCESSFUL') {
    reasons.push(
      status.normalised === 'pending' || status.normalised === 'unknown'
        ? `Status "${String(record.status)}" is not final. Poll again; do not resend.`
        : `Status is ${status.normalised} ("${String(record.status)}").`,
    );
  }

  return result({
    safe_to_give_value: !reversed && record.status === 'SUCCESSFUL',
    final,
    reasons: reasons.length ? reasons : ['Final status SUCCESSFUL, no reversal seen.'],
    status: status.normalised,
    raw_status: status.raw,
    id: record.id ?? args.id,
    reference: record.reference ?? args.reference,
    ...describeEnvironment({ ...process.env, FLW_API_VERSION: version }),
  });
}

export function registerVerifyTools() {
  const wrap = (fn: () => Promise<ReturnType<typeof result>>) =>
    fn().catch((error: unknown) => ({
      isError: true,
      content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    }));

  server.tool(
    'verify_payment',
    [
      'Check a payment on Flutterwave before giving value.',
      'Returns safe_to_give_value: true only when the status is successful, the amount is at least the amount expected, and the currency and your reference match.',
      'Unknown statuses count as pending. Uses this server API version status values (v3: successful; v4 charge: succeeded, order: completed).',
    ].join(' '),
    VerifyPaymentSchema,
    async (args) => wrap(() => verifyPayment(args)),
  );

  server.tool(
    'verify_payout',
    [
      'Check a transfer (payout) before treating it as paid.',
      'safe_to_give_value is true only on a final SUCCESSFUL status with no reversal. NEW, PENDING and INITIATED are not final: poll again later, never resend.',
      'Sandbox transfers can stay NEW for about 2 minutes.',
    ].join(' '),
    VerifyPayoutSchema,
    async (args) => wrap(() => verifyPayout(args)),
  );
}
