/**
 * v3 contract tests against Test Mode. They run only when FLW_SANDBOX_SECRET_KEY
 * holds a test key (FLWSECK_TEST...), and are skipped otherwise:
 *
 *   FLW_SANDBOX_SECRET_KEY=FLWSECK_TEST-... npm run test:contract
 *
 * A live key is refused before any call.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const KEY = process.env.FLW_SANDBOX_SECRET_KEY;
const isTestKey = !!KEY && KEY.startsWith('FLWSECK_TEST');

async function v3Get(path: string) {
  const r = await fetch(`https://api.flutterwave.com/v3${path}`, { headers: { Authorization: `Bearer ${KEY}` } });
  return (await r.json()) as { data?: any };
}

const text = (r: { content: Array<{ text: string }> }) => r.content.map((c) => c.text).join('\n');

describe.skipIf(!isTestKey)('v3 Test Mode contract', () => {
  let mod: Record<string, any>;

  beforeAll(async () => {
    process.env.FLW_API_VERSION = 'v3';
    process.env.FLW_SECRET_KEY = KEY;
    process.env.FLW_LOOKUP_DELAYS_MS = '2000,5000,10000';
    vi.resetModules();
    mod = {
      ...(await import('../../tools/transfer.js')),
      ...(await import('../../tools/verify.js')),
    };
  });

  it('verify_payment is safe for a real successful transaction with matching details', async () => {
    const tx = (await v3Get('/transactions')).data.find((t: { status: string }) => t.status === 'successful');
    const out = JSON.parse(
      (await mod.verifyPayment({ id: String(tx.id), expected_amount: tx.amount, expected_currency: tx.currency, expected_reference: tx.tx_ref }, 'v3')).content[0].text,
    );
    expect(out.safe_to_give_value).toBe(true);
    expect(out.environment).toBe('test_mode');
  });

  it('verify_payment is not safe when the expected amount is higher', async () => {
    const tx = (await v3Get('/transactions')).data.find((t: { status: string }) => t.status === 'successful');
    const out = JSON.parse(
      (await mod.verifyPayment({ id: String(tx.id), expected_amount: tx.amount + 1, expected_currency: tx.currency, expected_reference: tx.tx_ref }, 'v3')).content[0].text,
    );
    expect(out.safe_to_give_value).toBe(false);
  });

  it('create_transfer with a fixed reference, then a retry, gives one transfer', async () => {
    const reference = `mcp_ct_${Date.now()}`;
    const args = { account_bank: '044', account_number: '0690000040', amount: 100, currency: 'NGN', narration: 'mcp contract', reference };
    const first = text(await mod.createTransfer(args));
    expect(first).toMatch(new RegExp(`reference=${reference}|${reference}`));
    await mod.createTransfer(args); // same reference: must not create a second transfer
    const found = (await v3Get(`/transfers?reference=${reference}`)).data ?? [];
    expect(found.filter((t: { reference: string }) => t.reference === reference)).toHaveLength(1);
  }, 90_000);

  it('a new transfer is not final: verify_payout says poll, not safe', async () => {
    const latest = (await v3Get('/transfers')).data.find((t: { status: string }) => t.status === 'NEW' || t.status === 'PENDING');
    if (!latest) return; // nothing pending in the account right now
    const out = JSON.parse((await mod.verifyPayout({ id: String(latest.id) }, 'v3')).content[0].text);
    expect(out).toMatchObject({ safe_to_give_value: false, final: false });
  });

  // The _PMCK_ST_F failure trigger needs a v3 bank-transfer charge, which has no MCP tool.
  it.todo('failure trigger: a _PMCK_ST_F reference fails and is reported clearly');
  // Refund creation in Test Mode failed on 7 Nov 2026 and is not re-tested.
  it.todo('refund in Test Mode (known sandbox defect until fixed)');
});
