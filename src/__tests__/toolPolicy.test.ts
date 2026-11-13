import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { applyToolPolicy, registeredTools } from '../tools/policy.js';

function serverWith(...names: string[]) {
  const server = new McpServer({ name: 't', version: '0' });
  for (const name of names) {
    server.tool(name, name, async () => ({ content: [] }));
  }
  return server;
}

describe('--tools filter', () => {
  it('keeps only the listed tools', () => {
    const server = serverWith('a', 'b', 'c');
    expect(applyToolPolicy(server, { tools: ['a', ' c'] })).toEqual(['a', 'c']);
    expect(Object.keys(registeredTools(server))).toEqual(['a', 'c']);
  });

  it('keeps every tool for "all" or no list', () => {
    expect(applyToolPolicy(serverWith('a', 'b'), { tools: ['all'] })).toEqual(['a', 'b']);
    expect(applyToolPolicy(serverWith('a', 'b'), {})).toEqual(['a', 'b']);
  });
});

describe('startServer applies --tools to the real v4 registry', () => {
  afterEach(() => {
    delete process.env.FLW_API_VERSION;
    vi.restoreAllMocks();
  });

  it('registers only get_banks and list_charges', async () => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.FLW_API_VERSION = 'v4';
    const { server, startServer } = await import('../server.js');
    await startServer({ tools: ['get_banks', 'list_charges'] });
    expect(Object.keys(registeredTools(server)).sort()).toEqual(['get_banks', 'list_charges']);
  });
});

describe('raw card tools', () => {
  it('are removed by default, even with --tools=all', () => {
    const server = serverWith('charge_card', 'create_card_payment_method', 'get_banks');
    expect(applyToolPolicy(server, { tools: ['all'] })).toEqual(['get_banks']);
  });

  it('stay when the switch is on', () => {
    const server = serverWith('charge_card', 'get_banks');
    expect(applyToolPolicy(server, { tools: ['all'], rawCardTools: true })).toEqual([
      'charge_card',
      'get_banks',
    ]);
  });
});

describe('read-only mode in the policy step', () => {
  it('keeps only read tools', () => {
    const server = serverWith('get_banks', 'create_transfer', 'verify_payment', 'delete_transfer_sender', 'resend_webhook');
    expect(applyToolPolicy(server, { tools: ['all'], readOnly: true })).toEqual(['get_banks', 'verify_payment']);
  });
});
