import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { applyToolPolicy } from '../tools/policy.js';
import { amountOf, capError, checkToken, issueToken } from '../tools/confirm.js';

const ARGS = { amount: 1500, currency: 'NGN', account_bank: '044', account_number: '0690000031' };

async function setup(opts: { elicit?: 'accept' | 'decline'} = {}) {
  const server = new McpServer({ name: 't', version: '0' });
  const inner = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'sent' }] }));
  server.tool(
    'create_transfer',
    'Create a transfer.',
    { amount: z.number(), currency: z.string(), account_bank: z.string(), account_number: z.string() },
    inner,
  );
  server.tool('get_banks', 'Banks.', async () => ({ content: [{ type: 'text' as const, text: 'banks' }] }));
  applyToolPolicy(server, {});

  const client = new Client({ name: 'c', version: '0' }, { capabilities: opts.elicit ? { elicitation: {} } : {} });
  if (opts.elicit) {
    client.setRequestHandler(ElicitRequestSchema, async () =>
      opts.elicit === 'accept' ? { action: 'accept', content: { confirm: true } } : { action: 'decline' },
    );
  }
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (args: Record<string, unknown>, name = 'create_transfer') => {
    const out = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    let body: Record<string, unknown> | string = out.content[0].text;
    try {
      body = JSON.parse(out.content[0].text);
    } catch {
      /* plain text */
    }
    return { out, body: body as Record<string, any> };
  };
  return { inner, call, client };
}

describe('confirmation token flow (client without elicitation)', () => {
  afterEach(() => {
    delete process.env.FLW_MAX_AMOUNT;
    delete process.env.FLW_MAX_AMOUNT_NGN;
    delete process.env.FLW_CONFIRM;
  });

  it('first call sends nothing and returns a summary and token', async () => {
    const { inner, call } = await setup();
    const { body } = await call(ARGS);
    expect(body.status).toBe('confirmation_required');
    expect(body.summary.arguments).toEqual(ARGS);
    expect(body.confirmation_token).toMatch(/^\d+\.[0-9a-f]{64}$/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('the same arguments plus the token run the tool once', async () => {
    const { inner, call } = await setup();
    const { body } = await call(ARGS);
    const second = await call({ ...ARGS, confirmation_token: body.confirmation_token });
    expect(second.body).toBe('sent');
    expect(inner).toHaveBeenCalledTimes(1);
    expect((inner.mock.calls[0] as unknown[])[0]).toEqual(ARGS); // token is not passed on
    const third = await call({ ...ARGS, confirmation_token: body.confirmation_token });
    expect(third.body.reason).toMatch(/already used/);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('a token does not work with changed arguments', async () => {
    const { inner, call } = await setup();
    const { body } = await call(ARGS);
    const changed = await call({ ...ARGS, amount: 150000, confirmation_token: body.confirmation_token });
    expect(changed.out.isError).toBe(true);
    expect(changed.body.reason).toMatch(/does not match/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('read tools need no confirmation', async () => {
    const { call } = await setup();
    expect((await call({}, 'get_banks')).body).toBe('banks');
  });

  it('FLW_CONFIRM=false skips confirmation', async () => {
    process.env.FLW_CONFIRM = 'false';
    expect((await (await setup()).call(ARGS)).body).toBe('sent');
  });
});

describe('elicitation (client asks the user)', () => {
  it('runs the tool when the user accepts', async () => {
    const { inner, call } = await setup({ elicit: 'accept' });
    expect((await call(ARGS)).body).toBe('sent');
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('sends nothing when the user declines', async () => {
    const { inner, call } = await setup({ elicit: 'decline' });
    expect((await call(ARGS)).body.status).toBe('not_sent');
    expect(inner).not.toHaveBeenCalled();
  });
});

describe('amount cap', () => {
  afterEach(() => {
    delete process.env.FLW_MAX_AMOUNT;
    delete process.env.FLW_MAX_AMOUNT_NGN;
  });

  it('refuses an amount above FLW_MAX_AMOUNT before any confirmation', async () => {
    process.env.FLW_MAX_AMOUNT = '1000';
    const { inner, call } = await setup({ elicit: 'accept' });
    const { out, body } = await call(ARGS);
    expect(out.isError).toBe(true);
    expect(body).toMatch(/above the cap of 1000 set by FLW_MAX_AMOUNT/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('a per-currency cap wins over the general one', () => {
    expect(capError(ARGS, { FLW_MAX_AMOUNT: '10', FLW_MAX_AMOUNT_NGN: '2000' })).toBeNull();
    expect(capError(ARGS, { FLW_MAX_AMOUNT: '99999', FLW_MAX_AMOUNT_NGN: '1000' })).toMatch(/FLW_MAX_AMOUNT_NGN/);
    expect(capError(ARGS, {})).toBeNull();
  });

  it('finds the amount in v3 and v4 argument shapes', () => {
    expect(amountOf({ amount: '250', currency: 'GHS' })).toEqual({ amount: 250, currency: 'GHS' });
    expect(
      amountOf({ payment_instruction: { source_currency: 'NGN', amount: { value: 900, applies_to: 'source_currency' } } }),
    ).toEqual({ amount: 900, currency: 'NGN' });
    expect(amountOf({ id: 'trf_1' })).toEqual({ amount: undefined, currency: undefined });
  });
});

describe('tokens', () => {
  it('expire after 5 minutes', () => {
    const t = issueToken('create_transfer', ARGS, 0);
    expect(checkToken('create_transfer', ARGS, t, 5 * 60_000 + 1)).toMatch(/expired/);
  });

  it('are bound to the tool name', () => {
    const t = issueToken('create_transfer', ARGS);
    expect(checkToken('pay_bill', ARGS, t)).toMatch(/does not match/);
  });

  it('do not depend on key order', () => {
    const t = issueToken('create_transfer', { a: 1, b: { c: 2, d: 3 } });
    expect(checkToken('create_transfer', { b: { d: 3, c: 2 }, a: 1 }, t)).toBeNull();
  });

  it('reject garbage', () => {
    expect(checkToken('create_transfer', ARGS, 'nope')).toMatch(/not valid/);
    expect(checkToken('create_transfer', ARGS, '9999999999999.zz')).toMatch(/not valid/);
  });

  it('leading zeros do not make a used token new again (review N1)', () => {
    const args = { ...ARGS, amount: 1501 };
    const t = issueToken('create_transfer', args);
    expect(checkToken('create_transfer', args, t)).toBeNull();
    for (const variant of [`0${t}`, `00${t}`]) {
      expect(checkToken('create_transfer', args, variant)).not.toBeNull();
    }
  });

  it('a used token cannot be replayed in another spelling (review H2)', () => {
    const t = issueToken('create_transfer', ARGS);
    expect(checkToken('create_transfer', ARGS, t)).toBeNull();
    for (const variant of [t, `${t}.x`, t.toUpperCase(), `${t}zz`, ` ${t}`, `${t}\n`, t.replace('.', '..')]) {
      expect(checkToken('create_transfer', ARGS, variant)).not.toBeNull();
    }
  });
});

describe('amount cap holes from the review (M1)', () => {
  const NGN_CAP = { FLW_MAX_AMOUNT_NGN: '100000' };

  it('refuses an amount it cannot read when a cap is set', () => {
    expect(capError({ amount: '5,000,000', currency: 'NGN' }, NGN_CAP, 'charge_ussd')).toMatch(/not a plain number/);
    expect(capError({ amount: '1e9', currency: 'NGN' }, NGN_CAP, 'charge_ussd')).toMatch(/not a plain number/);
    expect(capError({ currency: 'NGN' }, NGN_CAP, 'create_refund')).toMatch(/no amount/);
    expect(capError({ amount: '1500.50', currency: 'NGN' }, NGN_CAP, 'charge_ussd')).toBeNull();
  });

  it('checks the destination currency when the amount applies to it', () => {
    const args = {
      payment_instruction: { source_currency: 'NGN', destination_currency: 'USD', amount: { value: 50000, applies_to: 'destination_currency' } },
    };
    expect(capError(args, { FLW_MAX_AMOUNT_NGN: '100000', FLW_MAX_AMOUNT_USD: '1000' }, 'create_transfer')).toMatch(/50000 USD.*FLW_MAX_AMOUNT_USD/);
    // Only an NGN cap, unknown destination currency on a destination-currency amount: refuse, don't guess.
    const noDest = { payment_instruction: { source_currency: 'NGN', amount: { value: 50000, applies_to: 'destination_currency' } } };
    expect(capError(noDest, { FLW_MAX_AMOUNT_NGN: '100000' }, 'create_transfer')).toMatch(/currency of this call can't be read/);
  });

  it('caps FX by the quote quantity, and bills in NGN', () => {
    expect(capError({ quantity: 5000, base_currency: 'USD' }, { FLW_MAX_AMOUNT_USD: '1000' }, 'request_fx_quote')).toMatch(/5000 USD/);
    expect(capError({ amount: 200000 }, NGN_CAP, 'pay_bill')).toMatch(/200000 NGN/);
  });

  it('incoming no-amount tools are not blocked; outgoing ones are refused under a cap (review N2)', () => {
    for (const tool of ['validate_charge', 'update_order', 'update_charge']) {
      expect(capError({ id: 'x' }, NGN_CAP, tool)).toBeNull();
    }
    for (const tool of ['retry_transfer', 'update_transfer', 'initiate_fx_trade']) {
      expect(capError({ id: 'x' }, NGN_CAP, tool)).toMatch(/no amount the server can check/);
      expect(capError({ id: 'x' }, {}, tool)).toBeNull(); // no cap, test mode
    }
    // update_chargeback carries an amount, so the cap applies.
    expect(capError({ amount: 200000, currency: 'NGN' }, NGN_CAP, 'update_chargeback')).toMatch(/above the cap/);
  });

  it('live mode refuses a currency without its own cap (review N3)', () => {
    const live = { FLW_API_VERSION: 'v4', FLW_ENVIRONMENT: 'production', FLW_MAX_AMOUNT_NGN: '100000' };
    expect(capError({ amount: 1e9, currency: 'USD' }, live, 'create_charge')).toMatch(/no cap for USD/);
    expect(capError({ amount: 1e9, currency: 'USD' }, NGN_CAP, 'create_charge')).toBeNull(); // test mode
  });

  it('pay_bill outside Nigeria has no currency, so a cap refuses it (review N5)', () => {
    expect(capError({ amount: 10, country: 'GH' }, NGN_CAP, 'pay_bill')).toMatch(/currency of this call can't be read/);
  });

  it('live mode requires a cap', () => {
    const live = { FLW_API_VERSION: 'v4', FLW_ENVIRONMENT: 'production' };
    expect(capError({ amount: 1, currency: 'NGN' }, live, 'create_charge')).toMatch(/Live mode needs an amount cap/);
  });
});

describe('self-confirmation guard (H1)', () => {
  afterEach(() => {
    delete process.env.FLW_REQUIRE_ELICITATION;
  });

  it('FLW_REQUIRE_ELICITATION=true blocks money tools in clients that cannot ask the person', async () => {
    process.env.FLW_REQUIRE_ELICITATION = 'true';
    const { inner, call } = await setup();
    const { out, body } = await call(ARGS);
    expect(out.isError).toBe(true);
    expect(body.reason).toMatch(/cannot ask you to confirm directly/);
    expect(inner).not.toHaveBeenCalled();
  });

  it('still works when the client can ask the person', async () => {
    process.env.FLW_REQUIRE_ELICITATION = 'true';
    const { inner, call } = await setup({ elicit: 'accept' });
    expect((await call(ARGS)).body).toBe('sent');
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
