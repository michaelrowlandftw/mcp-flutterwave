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
    expect(checkToken('create_transfer', ARGS, '9999999999999.zz')).toMatch(/does not match/);
  });
});
