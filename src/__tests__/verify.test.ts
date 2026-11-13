import { describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normaliseStatus, STATUS_MAPS } from '../verify/statusMaps.js';
import { verifyPayment, verifyPayout } from '../tools/verify.js';
import { applyToolPolicy, registeredTools } from '../tools/policy.js';

// Expected mappings, written out by hand so a change to the map must change the test too.
const EXPECTED = {
  v3: {
    collection: { successful: 'successful', pending: 'pending', failed: 'failed' },
    payout: { NEW: 'pending', PENDING: 'pending', SUCCESSFUL: 'successful', FAILED: 'failed', REVERSED: 'reversed' },
    refund: {
      processing: 'pending', 'pending-bank-transfer': 'pending', 'pending-momo': 'pending',
      completed: 'successful', 'completed-bank-transfer': 'successful', 'completed-preauth': 'successful', failed: 'failed',
    },
  },
  v4: {
    collection: { succeeded: 'successful', pending: 'pending', failed: 'failed', voided: 'failed' },
    order: { completed: 'successful', pending: 'pending', authorized: 'pending', 'partially-completed': 'pending', voided: 'failed', failed: 'failed' },
    payout: { NEW: 'pending', PENDING: 'pending', INITIATED: 'pending', SUCCESSFUL: 'successful', FAILED: 'failed', CANCELLED: 'failed', REVERSED: 'reversed' },
    refund: { new: 'pending', pending: 'pending', requires_action: 'pending', succeeded: 'successful', completed: 'successful', failed: 'failed', cancelled: 'failed' },
    settlement: {
      'disburse-pending': 'pending', pending: 'pending', reviewed: 'pending', approved: 'pending', processing: 'pending',
      flagged: 'pending', 'on-hold': 'pending', completed: 'successful', 'completed-offline': 'successful', failed: 'failed',
    },
  },
} as const;

const UNKNOWN_VALUES = ['', 'SUCCESS', 'Successful', 'success', 'ok', 'paid', 'constructor', '__proto__', 'toString', null, undefined, 1, true];

describe('status maps', () => {
  for (const [version, objects] of Object.entries(EXPECTED)) {
    for (const [object, values] of Object.entries(objects)) {
      it(`${version} ${object}: every known value maps as expected`, () => {
        expect(STATUS_MAPS[version as 'v3'][object as 'payout']).toEqual(values);
        for (const [raw, normalised] of Object.entries(values)) {
          expect(normaliseStatus(version as 'v3', object as 'payout', raw)).toEqual({ normalised, raw });
        }
      });

      it(`${version} ${object}: unknown values map to unknown, never successful`, () => {
        for (const raw of UNKNOWN_VALUES) {
          expect(normaliseStatus(version as 'v3', object as 'payout', raw).normalised).toBe('unknown');
        }
      });
    }
  }

  it("does not accept the other version's success value", () => {
    expect(normaliseStatus('v3', 'collection', 'succeeded').normalised).toBe('unknown');
    expect(normaliseStatus('v4', 'collection', 'successful').normalised).toBe('unknown');
    expect(normaliseStatus('v4', 'payout', 'successful').normalised).toBe('unknown'); // list-filter case
  });
});

const fixed = (record: Record<string, unknown> | null) => vi.fn(async () => record);

const V3_OK = { id: 1, status: 'successful', amount: 1500, currency: 'NGN', tx_ref: 'ref-1' };
const V4_OK = { id: 'chg_1', status: 'succeeded', amount: 1500, currency: 'NGN', reference: 'ref-1' };
const EXPECT = { id: 'x', expected_amount: 1500, expected_currency: 'NGN', expected_reference: 'ref-1' };

async function payment(version: 'v3' | 'v4', record: Record<string, unknown> | null, args = EXPECT) {
  return JSON.parse((await verifyPayment(args, version, fixed(record))).content[0].text);
}

describe('verify_payment', () => {
  it.each([
    ['v3', V3_OK],
    ['v4', V4_OK],
  ] as const)('%s: safe when status, amount, currency and reference match', async (version, record) => {
    const out = await payment(version, record);
    expect(out.safe_to_give_value).toBe(true);
    expect(out.status).toBe('successful');
    expect(out.api_version).toBe(version);
    expect(out.environment).toBeDefined();
  });

  it('accepts an amount above the expected one', async () => {
    expect((await payment('v4', { ...V4_OK, amount: 2000 })).safe_to_give_value).toBe(true);
  });

  it.each([
    ['amount too low', 'v3', { ...V3_OK, amount: 1499.99 }, /Amount/],
    ['amount too low', 'v4', { ...V4_OK, amount: '100' }, /Amount/],
    ['currency mismatch', 'v3', { ...V3_OK, currency: 'USD' }, /Currency/],
    ['currency mismatch', 'v4', { ...V4_OK, currency: 'GHS' }, /Currency/],
    ['reference mismatch', 'v3', { ...V3_OK, tx_ref: 'other' }, /Reference/],
    ['reference mismatch', 'v4', { ...V4_OK, reference: 'other' }, /Reference/],
    ['non-final status', 'v3', { ...V3_OK, status: 'pending' }, /pending/],
    ['non-final status', 'v4', { ...V4_OK, status: 'pending' }, /pending/],
    ['failed status', 'v4', { ...V4_OK, status: 'voided' }, /failed/],
    ['unknown status', 'v3', { ...V3_OK, status: 'SUCCESSFUL' }, /not a known v3 status/],
    ['other version success', 'v4', { ...V4_OK, status: 'successful' }, /not a known v4 status/],
    ['missing amount', 'v4', { ...V4_OK, amount: undefined }, /Amount/],
  ] as const)('%s (%s) is not safe', async (_label, version, record, reason) => {
    const out = await payment(version, record);
    expect(out.safe_to_give_value).toBe(false);
    expect(out.reasons.join(' ')).toMatch(reason);
  });

  it('is not safe when the payment does not exist', async () => {
    expect((await payment('v4', null)).safe_to_give_value).toBe(false);
  });

  it('uses the order status map for v4 order IDs', async () => {
    const get = fixed({ ...V4_OK, id: 'ord_1', status: 'completed' });
    const out = JSON.parse((await verifyPayment({ ...EXPECT, id: 'ord_1' }, 'v4', get)).content[0].text);
    expect(get).toHaveBeenCalledWith('/orders/ord_1');
    expect(out.safe_to_give_value).toBe(true);
  });
});

async function payout(version: 'v3' | 'v4', record: Record<string, unknown> | null, args: { id?: string; reference?: string } = { id: '7' }) {
  return JSON.parse((await verifyPayout(args, version, fixed(record), async () => record)).content[0].text);
}

describe('verify_payout', () => {
  it.each(['v3', 'v4'] as const)('%s: only a final SUCCESSFUL is safe', async (version) => {
    const out = await payout(version, { id: 7, status: 'SUCCESSFUL', reference: 'r' });
    expect(out).toMatchObject({ safe_to_give_value: true, final: true });
  });

  it.each([
    ['v3', 'NEW'], ['v3', 'PENDING'], ['v4', 'NEW'], ['v4', 'PENDING'], ['v4', 'INITIATED'], ['v4', 'successful'],
  ] as const)('%s %s is not final and not safe', async (version, status) => {
    const out = await payout(version, { id: 7, status });
    expect(out).toMatchObject({ safe_to_give_value: false, final: false });
    expect(out.reasons.join(' ')).toMatch(/not final/);
  });

  it.each(['v3', 'v4'] as const)('%s: FAILED is final and not safe', async (version) => {
    expect(await payout(version, { id: 7, status: 'FAILED' })).toMatchObject({ safe_to_give_value: false, final: true });
  });

  it.each([
    ['REVERSED status', { id: 7, status: 'REVERSED' }],
    ['reversal after success', { id: 7, status: 'SUCCESSFUL', complete_message: 'Transfer reversed by bank' }],
  ])('flags a %s', async (_label, record) => {
    const out = await payout('v3', record);
    expect(out.safe_to_give_value).toBe(false);
    expect(out.reasons.join(' ')).toMatch(/reversed/);
  });

  it('v4 looks a transfer up by reference', async () => {
    const out = await payout('v4', { id: 'trf_1', status: 'SUCCESSFUL', reference: 'r-1' }, { reference: 'r-1' });
    expect(out.safe_to_give_value).toBe(true);
  });

  it('v3 needs an id', async () => {
    await expect(verifyPayout({ reference: 'r' }, 'v3', fixed(null))).rejects.toThrow(/needs the transfer id/);
  });
});

describe('every tool result states its environment', () => {
  it('appends flutterwave_environment and adds the verify hint to create tools', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    server.tool('create_thing', 'Create a thing.', async () => ({ content: [{ type: 'text', text: 'done' }] }));
    server.tool('get_thing', 'Get a thing.', async () => ({ content: [{ type: 'text', text: 'done' }] }));
    applyToolPolicy(server, {});
    const tools = registeredTools(server);
    expect(tools.create_thing.description).toMatch(/verify_payment or verify_payout/);
    expect(tools.get_thing.description).not.toMatch(/verify_payment/);
    const out = await (tools.get_thing.handler as (...a: unknown[]) => Promise<{ content: Array<{ text: string }> }>)({}, {});
    expect(JSON.parse(out.content[1].text).flutterwave_environment.environment).toBeDefined();
  });
});
