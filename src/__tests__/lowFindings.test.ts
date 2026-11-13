import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assertSafePath } from '../client/v4/http.js';
import { applyToolPolicy, registeredTools } from '../tools/policy.js';

describe('dot segments in request paths (review L4)', () => {
  it.each(['/charges/..', '/transfers/../retries', '/charges/%2E%2E', '/charges/.', '/x/%2e/y?z=1'])('refuses %s', (path) => {
    expect(() => assertSafePath(path)).toThrow(/can't be "\." or "\.\."/);
  });

  it.each(['/charges/chg_1', '/transfers?from=2026-11-13', '/charges/a.b', '/x/...'])('allows %s', (path) => {
    expect(() => assertSafePath(path)).not.toThrow();
  });
});

describe('callback and redirect URLs must be https (review L5)', () => {
  const setup = () => {
    const server = new McpServer({ name: 't', version: '0' });
    server.tool('get_echo', 'Echo.', { callback_url: z.string().optional(), redirect_url: z.string().optional() }, async () => ({
      content: [{ type: 'text' as const, text: 'ran' }],
    }));
    applyToolPolicy(server, {});
    return registeredTools(server).get_echo.handler as (a: unknown, e: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
  };

  it.each([
    { callback_url: 'http://example.com/hook' },
    { redirect_url: 'javascript:alert(1)' },
    { callback_url: 'https://evil.example/ x' },
    { redirect_url: 42 },
  ])('refuses %j', async (args) => {
    const out = await setup()(args, {});
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toMatch(/must be an https URL/);
  });

  it('allows https and absent URLs', async () => {
    expect((await setup()({ callback_url: 'https://merchant.example/hook' }, {})).content[0].text).toBe('ran');
    expect((await setup()({}, {})).content[0].text).toBe('ran');
  });
});

describe('dot segments in v3 path parameters (review N6)', () => {
  it('the v3 middleware refuses "." and ".." path parameters', async () => {
    const { default: mw } = await import('../client/middleware/authMiddlewareV3.js');
    const request = new Request('https://api.flutterwave.com/v3/status');
    for (const reference of ['..', '.', '%2e%2e']) {
      await expect(mw.onRequest!({ request, params: { path: { reference } } } as never)).rejects.toThrow(/can't be/);
    }
    await expect(mw.onRequest!({ request, params: { path: { reference: 'BPUSSD123' } } } as never)).resolves.toBeTruthy();
  });
});

describe('URL rules (review N8) and update_charge PINs (review N10)', () => {
  const make = (name: string, options = {}) => {
    const server = new McpServer({ name: 't', version: '0' });
    server.tool(name, 'x', { meta: z.any().optional(), redirect_url: z.string().optional(), authorization: z.any().optional() }, async () => ({
      content: [{ type: 'text' as const, text: 'ran' }],
    }));
    applyToolPolicy(server, options);
    return registeredTools(server)[name].handler as (a: unknown, e: unknown) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;
  };
  const ran = async (h: ReturnType<typeof make>, args: unknown) => (await h(args, {})).content[0].text;

  it('checks nested callback URLs', async () => {
    expect(await ran(make('get_x'), { meta: { inner: { callback_url: 'http://evil.example' } } })).toMatch(/must be an https URL/);
  });

  it('allows http://localhost in test mode', async () => {
    expect(await ran(make('get_x'), { redirect_url: 'http://localhost:3000/done' })).toBe('ran');
  });

  it('FLW_ALLOWED_URL_HOSTS restricts hosts', async () => {
    process.env.FLW_ALLOWED_URL_HOSTS = 'merchant.example';
    try {
      expect(await ran(make('get_x'), { redirect_url: 'https://other.example/x' })).toMatch(/not in FLW_ALLOWED_URL_HOSTS/);
      expect(await ran(make('get_x'), { redirect_url: 'https://merchant.example/x' })).toBe('ran');
    } finally {
      delete process.env.FLW_ALLOWED_URL_HOSTS;
    }
  });

  it('update_charge runs without a PIN, and is refused with one unless card tools are on', async () => {
    expect(await ran(make('update_charge'), { authorization: { type: 'otp', otp: { code: '123456' } } })).not.toMatch(/PIN/);
    expect(await ran(make('update_charge'), { authorization: { type: 'pin', pin: { nonce: 'n', encrypted_pin: 'x' } } })).toMatch(/needs the raw card tools switch/);
  });
});
