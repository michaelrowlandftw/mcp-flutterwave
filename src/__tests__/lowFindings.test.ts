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
