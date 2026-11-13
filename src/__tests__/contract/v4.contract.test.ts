/**
 * v4 contract tests against the developer sandbox (cases from the test findings
 * pack, section 5). They run only when FLW_SANDBOX_CLIENT_ID and
 * FLW_SANDBOX_CLIENT_SECRET are set, and are skipped otherwise:
 *
 *   FLW_SANDBOX_CLIENT_ID=... FLW_SANDBOX_CLIENT_SECRET=... npm run test:contract
 *
 * Separate variable names are used because vitest.config.ts sets dummy values
 * for the normal ones. Sandbox only: the base URL is checked before any call.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const ID = process.env.FLW_SANDBOX_CLIENT_ID;
const SECRET = process.env.FLW_SANDBOX_CLIENT_SECRET;
const RECIPIENT = process.env.FLW_SANDBOX_RECIPIENT_ID; // optional: enables the transfer cases

const today = () => new Date().toISOString().slice(0, 10);
const body = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);

describe.skipIf(!ID || !SECRET)('v4 sandbox contract', () => {
  let mod: Record<string, any>;

  beforeAll(async () => {
    process.env.FLW_API_VERSION = 'v4';
    process.env.FLW_CLIENT_ID = ID;
    process.env.FLW_CLIENT_SECRET = SECRET;
    delete process.env.FLW_ENVIRONMENT;
    process.env.FLW_LOOKUP_DELAYS_MS = '2000,5000,10000';
    vi.resetModules();
    const { getV4BaseUrl } = await import('../../client/v4/environment.js');
    expect(getV4BaseUrl()).toBe('https://developersandbox-api.flutterwave.com');
    mod = {
      ...(await import('../../tools/v4/listTransfers.js')),
      ...(await import('../../tools/v4/getWalletStatement.js')),
      ...(await import('../../tools/v4/listCharges.js')),
      ...(await import('../../tools/v4/listRefunds.js')),
      ...(await import('../../tools/v4/listSettlements.js')),
      ...(await import('../../tools/v4/createCustomer.js')),
      ...(await import('../../tools/v4/createVirtualAccount.js')),
      ...(await import('../../tools/v4/listVirtualAccounts.js')),
      ...(await import('../../tools/v4/createTransfer.js')),
      ...(await import('../../tools/verify.js')),
      ...(await import('../../client/v4/scenario.js')),
    };
  });

  describe('date formats', () => {
    it('one day, date only: list_transfers and get_wallet_statement return 200', async () => {
      expect(body(await mod.listTransfers({ from: today(), to: today() })).status).toBe(200);
      // No entries is mapped from 404 TRANSFER_NOT_FOUND to an empty list.
      expect(body(await mod.getWalletStatement({ currency: 'NGN', from: today(), to: today() })).status).toBe(200);
    });

    it('one day, ISO: list_charges, list_refunds and list_settlements return 200', async () => {
      const from = `${today()}T00:00:00Z`;
      const now = new Date(Date.now() - 120_000).toISOString();
      expect(body(await mod.listCharges({ from, to: now })).status).toBe(200);
      expect(body(await mod.listRefunds({ from, to: `${today()}T23:59:59Z` })).status).toBe(200);
      expect(body(await mod.listSettlements({ from, to: `${today()}T23:59:59Z` })).status).toBe(200);
    });

    it('a wrong format gives a clear error before any call', async () => {
      await expect(mod.listTransfers({ from: `${today()}T00:00:00Z` })).rejects.toThrow('schema validation');
      await expect(mod.listCharges({ from: today() })).rejects.toThrow('schema validation');
      await expect(mod.listCharges({ to: new Date(Date.now() + 3_600_000).toISOString() })).rejects.toThrow(/later than the current time/);
    });

    it('wallet statement without currency is refused by the tool', async () => {
      await expect(mod.getWalletStatement({} as never)).rejects.toThrow('schema validation');
    });
  });

  describe('create with a fixed reference, then retry', () => {
    it('gives one record, not two', async () => {
      const customer = body(await mod.createCustomer({ email: `mcp-contract-${Date.now()}@example.com`, name: { first: 'Mcp', last: 'Contract' } }));
      const customer_id = customer.body.data.id;
      const reference = `mcp-ct-${Date.now()}`;
      const args = { customer_id, reference, currency: 'NGN', account_type: 'dynamic', amount: 1500 };

      const first = body(await mod.createVirtualAccount(args));
      expect(first.status).toBe(201);
      // The retry carries the same reference and idempotency key.
      await mod.createVirtualAccount(args).catch((e: Error) => e);

      const list = body(await mod.listVirtualAccounts({ reference }));
      const rows = list.body.data.filter((r: { reference: string }) => r.reference === reference);
      expect(rows).toHaveLength(1);
    }, 60_000);
  });

  describe.skipIf(!RECIPIENT)('transfers with sandbox scenarios', () => {
    const transfer = (scenario: string) =>
      mod.withScenario(scenario, () =>
        mod.createTransfer({
          action: 'instant',
          narration: `mcp contract ${scenario}`,
          payment_instruction: { recipient_id: RECIPIENT!, source_currency: 'NGN', amount: { value: 100, applies_to: 'destination_currency' } },
        }),
      );

    it('scenario:successful ends SUCCESSFUL and verify_payout says safe', async () => {
      const created = body(await transfer('scenario:successful'));
      const out = body(await mod.verifyPayout({ id: created.body.data.id }, 'v4'));
      expect(out.raw_status).toBe('SUCCESSFUL');
      expect(out.safe_to_give_value).toBe(true);
    }, 60_000);

    it('scenario:insufficient_balance ends FAILED and verify_payout says not safe', async () => {
      const created = body(await transfer('scenario:insufficient_balance'));
      const out = body(await mod.verifyPayout({ id: created.body.data.id }, 'v4'));
      expect(out.raw_status).toBe('FAILED');
      expect(out.safe_to_give_value).toBe(false);
    }, 60_000);
  });
});
