import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../client/v4/auth.js', () => ({ getAccessToken: async () => 'tok', invalidateAccessTokenCache: () => {} }));

let seen: Headers[];

describe('sandbox scenarios (v4 X-Scenario-Key)', () => {
  beforeEach(() => {
    vi.resetModules();
    seen = [];
    process.env.FLW_API_VERSION = 'v4';
    process.env.FLW_CONFIRM = 'false';
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response(JSON.stringify({ status: 'success', data: { id: 'trf_1' } }), { status: 201 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.FLW_API_VERSION;
    delete process.env.FLW_CONFIRM;
    delete process.env.FLW_ENVIRONMENT;
  });

  it('sends X-Scenario-Key only inside a scenario', async () => {
    const { flwV4Fetch } = await import('../../client/v4/http.js');
    const { withScenario } = await import('../../client/v4/scenario.js');
    await withScenario('scenario:successful', () => flwV4Fetch('/transfers', { method: 'POST', body: '{}' }));
    await flwV4Fetch('/transfers', { method: 'POST', body: '{}' });
    expect(seen[0].get('X-Scenario-Key')).toBe('scenario:successful');
    expect(seen[1].has('X-Scenario-Key')).toBe(false);
  });

  it('never sends it outside the sandbox', async () => {
    process.env.FLW_ENVIRONMENT = 'production';
    const { flwV4Fetch } = await import('../../client/v4/http.js');
    const { withScenario } = await import('../../client/v4/scenario.js');
    await withScenario('scenario:successful', () => flwV4Fetch('/transfers', { method: 'GET' }));
    expect(seen[0].has('X-Scenario-Key')).toBe(false);
  });

  it('accepts only documented key shapes', async () => {
    const { SCENARIO_KEY } = await import('../../client/v4/scenario.js');
    for (const ok of ['scenario:successful', 'scenario:auth_pin&issuer:approved', 'scenario:auth_pin_3ds&issuer:do_not_honor']) {
      expect(SCENARIO_KEY.test(ok)).toBe(true);
    }
    for (const bad of ['successful', 'scenario:', 'scenario:a&b:c', 'scenario:x\r\nX-Evil: 1', 'scenario:A']) {
      expect(SCENARIO_KEY.test(bad)).toBe(false);
    }
  });

  it('the policy step adds sandbox_scenario to scenario tools, strips it, and sets the header', async () => {
    const { applyToolPolicy, registeredTools } = await import('../../tools/policy.js');
    const { flwV4Fetch } = await import('../../client/v4/http.js');
    const server = new McpServer({ name: 't', version: '0' });
    const inner = vi.fn(async (args: unknown) => {
      await flwV4Fetch('/transfers', { method: 'POST', body: JSON.stringify(args) });
      return { content: [{ type: 'text' as const, text: 'ok' }] };
    });
    server.tool('create_transfer', 'Create.', { amount: z.number() }, inner);
    server.tool('get_banks', 'Banks.', async () => ({ content: [] }));
    applyToolPolicy(server, {});
    const tools = registeredTools(server);
    const schema = tools.create_transfer.inputSchema as unknown as z.ZodObject<z.ZodRawShape>;
    expect(Object.keys(schema.shape)).toContain('sandbox_scenario');
    expect(schema.safeParse({ amount: 1, sandbox_scenario: 'nope' }).success).toBe(false);
    expect(Object.keys((tools.get_banks.inputSchema as unknown as { shape?: object })?.shape ?? {})).not.toContain('sandbox_scenario');

    await (tools.create_transfer.handler as (a: unknown, e: unknown) => Promise<unknown>)({ amount: 1, sandbox_scenario: 'scenario:insufficient_balance' }, {});
    expect(inner.mock.calls[0][0]).toEqual({ amount: 1 });
    expect(seen[0].get('X-Scenario-Key')).toBe('scenario:insufficient_balance');
  });

  it('get_sandbox_scenarios lists v4 keys and the no-webhook default for transfers, with no card numbers', async () => {
    const { sandboxScenarios } = await import('../../tools/sandbox.js');
    const text = sandboxScenarios('v4').content[0].text;
    const out = JSON.parse(text);
    expect(out.transfers.scenarios).toContain('scenario:daily_transfer_limit_exceeded');
    expect(out.transfers.default).toMatch(/NO webhook/);
    expect(out.not_available).toMatch(/FLW_FAULT/);
    expect(text).not.toMatch(/\d{13,19}/);
  });

  it('v3 lists test data and the failure-reference rule', async () => {
    const { sandboxScenarios } = await import('../../tools/sandbox.js');
    const out = JSON.parse(sandboxScenarios('v3').content[0].text);
    expect(out.bank_account_charge_ng.timeout).toContain('9876543210');
    expect(out.failure_references.rule).toMatch(/_PMCK_ST_F.*failure tests only/);
  });
});
