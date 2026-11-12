import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { installLogRedaction, redactResult, redactText } from '../utils/redact.js';
import { applyToolPolicy, registeredTools } from '../tools/policy.js';

// Test values only. 4242 4242 4242 4242 and 5531 8866 5214 2950 are public test cards.
// Fake keys, built at run time so secret scanners don't flag the source.
const fake = (prefix: string) => `${prefix}-${'0f'.repeat(16)}-X`;
const V3_KEY = fake(['FLWSECK', 'TEST'].join('_'));
const LIVE_KEY = fake('FLW' + 'SECK');
const PUB_KEY = fake(['FLWPUBK', 'TEST'].join('_'));
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJldmFsdWU';

describe('redactText', () => {
  it.each([
    ['v3 test secret key', `key=${V3_KEY}`],
    ['v3 live secret key', `failed with ${LIVE_KEY}`],
    ['public key', PUB_KEY],
    ['bearer token', 'Authorization: Bearer abc.def-ghi_123456789'],
    ['JWT', `token ${JWT}`],
  ])('removes a %s', (_label, input) => {
    const out = redactText(input, {});
    expect(out).toContain('[REDACTED]');
    expect(out).not.toMatch(/FLWSECK-|FLWSECK_TEST-|FLWPUBK|eyJhbGci|abc\.def-ghi/);
  });

  it('removes exact values of secret environment variables', () => {
    const env = { FLW_CLIENT_SECRET: 'v4-client-secret-value', FLW_SECRET_HASH: 'my-webhook-hash', FLW_ENCRYPTION_KEY_V4: 'short' };
    const out = redactText('secret v4-client-secret-value hash my-webhook-hash key short', env);
    expect(out).not.toContain('v4-client-secret-value');
    expect(out).not.toContain('my-webhook-hash');
    expect(out).toContain('short'); // under 8 characters: too common to mask safely
  });

  it('masks secret fields in JSON, whatever the case', () => {
    const json = JSON.stringify({ card_number: '4242424242424242', cvv: '123', PIN: 3310, otp: '12345', client_secret: 'x', amount: 1500, currency: 'NGN' });
    const out = redactText(json, {});
    expect(JSON.parse(out)).toEqual({
      card_number: '[REDACTED]', cvv: '[REDACTED]', PIN: '[REDACTED]', otp: '[REDACTED]', client_secret: '[REDACTED]', amount: 1500, currency: 'NGN',
    });
  });

  it('masks Luhn-valid card numbers anywhere, keeping the last 4', () => {
    expect(redactText('card 4242 4242 4242 4242 declined', {})).toBe('card [CARD ****4242] declined');
    expect(redactText('pan=5531-8866-5214-2950', {})).toBe('pan=[CARD ****2950]');
  });

  it('leaves references, IDs and amounts alone', () => {
    const text = 'flw_ref 4647385147661794050789116 id 10598477 tx_ref REF_BT_1794050786 amount 1500.00 ref mcp-e36dd66a0c634564aa59';
    expect(redactText(text, {})).toBe(text);
    expect(redactText('number 1234567890123', {})).toBe('number 1234567890123'); // fails Luhn
  });
});

describe('every tool result is redacted', () => {
  it('cleans text items, including errors thrown by a tool', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    server.tool('get_echo', 'Echo.', { v: z.string() }, async ({ v }) => ({ content: [{ type: 'text', text: v }] }));
    server.tool('get_boom', 'Boom.', async () => {
      throw new Error(`request failed: Authorization: Bearer ${JWT} for card 4242424242424242`);
    });
    applyToolPolicy(server, {});
    const tools = registeredTools(server);
    const call = (name: string, args: unknown) =>
      (tools[name].handler as (a: unknown, e: unknown) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>)(args, {});

    const echo = await call('get_echo', { v: JSON.stringify({ cvv: '123', key: V3_KEY }) });
    expect(echo.content[0].text).not.toMatch(/123|FLWSECK/);

    const boom = await call('get_boom', {});
    expect(boom.isError).toBe(true);
    expect(boom.content[0].text).not.toContain(JWT);
    expect(boom.content[0].text).toContain('[CARD ****4242]');
  });

  it('cleans the confirmation summary of a raw card tool', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    server.tool('charge_card', 'Charge.', { card_number: z.string(), cvv: z.string(), amount: z.number() }, async () => ({
      content: [{ type: 'text', text: 'sent' }],
    }));
    applyToolPolicy(server, { rawCardTools: true });
    const out = await (registeredTools(server).charge_card.handler as (a: unknown, e: unknown) => Promise<{ content: Array<{ text: string }> }>)(
      { card_number: '5531886652142950', cvv: '564', amount: 100 },
      { },
    );
    const text = out.content.map((c) => c.text).join('\n');
    expect(text).toContain('confirmation_required');
    expect(text).not.toMatch(/5531886652142950|"564"/);
  });

  it('redactResult ignores non-text items', () => {
    const r = { content: [{ type: 'resource', resource: { text: V3_KEY } }, { type: 'text', text: V3_KEY }] };
    redactResult(r);
    expect(r.content[1].text).toBe('[REDACTED]');
  });
});

describe('log redaction', () => {
  it('cleans strings, errors and objects passed to console', () => {
    const lines: unknown[][] = [];
    const fake = { log: (...a: unknown[]) => lines.push(a), info: () => {}, warn: () => {}, debug: () => {}, error: (...a: unknown[]) => lines.push(a) } as unknown as Console;
    installLogRedaction(fake);
    fake.error('bad key', V3_KEY);
    fake.error(new Error(`token ${JWT}`));
    fake.log({ card_number: '4242424242424242', amount: 10 });
    const all = JSON.stringify(lines);
    expect(all).not.toMatch(/FLWSECK_TEST-|eyJhbGci|4242424242424242/);
    expect(all).toContain('amount');
  });
});

describe('start-up', () => {
  it('index.ts installs log redaction before anything else', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(src.split(/\r?\n/)[1]).toBe('import "./logRedaction.js";');
    vi.restoreAllMocks();
  });
});
