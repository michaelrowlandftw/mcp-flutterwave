import { afterEach, describe, expect, it, vi } from 'vitest';
import { V3_ACCEPTED_TOOLS, V4_ACCEPTED_TOOLS } from '../config/acceptedTools.js';
import { annotationsFor, isClassified, MONEY_MOVING } from '../config/toolSafety.js';
import { registeredTools } from '../tools/policy.js';

const ALL = [...new Set([...V3_ACCEPTED_TOOLS, ...V4_ACCEPTED_TOOLS])];

describe('tool annotations', () => {
  it('every accepted tool is classified on purpose', () => {
    expect(ALL.filter((name) => !isClassified(name))).toEqual([]);
  });

  it('money-moving tools are destructive, not read-only, not idempotent', () => {
    for (const name of MONEY_MOVING) {
      expect(annotationsFor(name)).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
    }
  });

  it.each([
    ['get_charge', { readOnlyHint: true, destructiveHint: false, idempotentHint: true }],
    ['verify_payment', { readOnlyHint: true }],
    ['create_transfer', { readOnlyHint: false, destructiveHint: true }],
    ['pay_bill', { destructiveHint: true }],
    ['delete_transfer_sender', { destructiveHint: true, idempotentHint: true }],
    ['create_customer', { readOnlyHint: false, destructiveHint: false, idempotentHint: false }],
    ['update_customer', { destructiveHint: false, idempotentHint: true }],
    ['resend_webhook', { readOnlyHint: false, idempotentHint: false }],
  ])('%s', (name, expected) => {
    expect(annotationsFor(name)).toMatchObject({ ...expected, openWorldHint: true });
  });

  it('an unknown tool name defaults to a destructive write', () => {
    expect(annotationsFor('new_tool')).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe('annotations reach the registered v4 tools', () => {
  afterEach(() => {
    delete process.env.FLW_API_VERSION;
    vi.restoreAllMocks();
  });

  it('sets all three hints on every registered tool', async () => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.FLW_API_VERSION = 'v4';
    const { server, startServer } = await import('../server.js');
    await startServer({ tools: ['all'] });
    const tools = Object.entries(registeredTools(server));
    expect(tools.length).toBeGreaterThan(50);
    for (const [name, tool] of tools) {
      expect(tool.annotations, name).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        idempotentHint: expect.any(Boolean),
      });
    }
    expect(registeredTools(server).create_transfer.annotations?.destructiveHint).toBe(true);
  });
});
