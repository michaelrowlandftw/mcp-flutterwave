import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { parseArgs, RAW_CARD_REMOVED } from '../cli.js';
import { V3_ACCEPTED_TOOLS, V4_ACCEPTED_TOOLS } from '../config/acceptedTools.js';
import { CONFIRMED_WRITES, isClassified, MONEY_MOVING } from '../config/toolSafety.js';
import {
  assertTestCredentials,
  categoryOf,
  LIVE_MODE_APPROVED,
  liveConditionProblems,
  MONEY_CATEGORIES,
} from '../config/livePolicy.js';
import { KEYCHAIN_SETTINGS, loadKeychain, osKeychainReader } from '../config/keychain.js';
import { FILE_SETTINGS } from '../config/loadEnv.js';
import { capError } from '../tools/confirm.js';
import { UpdateChargeSchema } from '../tools/v4/updateCharge.js';
import { ChargeTokenizedCardSchema } from '../types/charge/schema.js';
import { redirectUrlOf } from '../tools/charge.js';
import { applyToolPolicy, registeredTools } from '../tools/policy.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** Security review of DX-RFC-001 (2026-11-17), adopted by Michael on 2026-11-22. */

const v3Test = { FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'FLWSECK_TEST-abc-X' };
const v3Live = { FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'FLWSECK-abc-X' };

const REMOVED = [
  'charge_card',
  'create_card_payment_method',
  'create_orchestrator_charge',
  'create_orchestrator_order',
];

describe('1. raw card tools are removed from the package', () => {
  it('are in neither allowlist', () => {
    for (const tool of REMOVED) {
      expect(V3_ACCEPTED_TOOLS as readonly string[]).not.toContain(tool);
      expect(V4_ACCEPTED_TOOLS as readonly string[]).not.toContain(tool);
    }
  });

  it('are refused by name', () => {
    expect(() => parseArgs(['--tools=charge_card'], v3Test)).toThrow(/Invalid tool: charge_card/);
  });

  it('the old switch stops start-up with an explanation', () => {
    expect(() => parseArgs(['--tools=all', '--enable-raw-card-tools'], v3Test)).toThrow(RAW_CARD_REMOVED);
    expect(() => parseArgs(['--tools=all'], { ...v3Test, FLW_ENABLE_RAW_CARD_TOOLS: 'true' })).toThrow(RAW_CARD_REMOVED);
    expect(() => parseArgs(['--tools=all'], { ...v3Test, FLW_ENABLE_RAW_CARD_TOOLS: 'false' })).toThrow(RAW_CARD_REMOVED);
  });

  it('update_charge has no PIN authorization', () => {
    const schema = z.object(UpdateChargeSchema);
    expect(schema.safeParse({ id: 'chg_1', authorization: { type: 'otp', otp: { code: '123456' } } }).success).toBe(true);
    expect(schema.safeParse({ id: 'chg_1', authorization: { type: 'pin', pin: { nonce: 'abcdefghijkl', encrypted_pin: 'x' } } }).success).toBe(false);
  });

  it('the encryption keys are no longer read from env files', () => {
    expect(FILE_SETTINGS.has('FLW_ENCRYPTION_KEY')).toBe(false);
    expect(FILE_SETTINGS.has('FLW_ENCRYPTION_KEY_V4')).toBe(false);
  });
});

describe('real registries hold no card or BVN tools', () => {
  afterEach(() => {
    delete process.env.FLW_API_VERSION;
    delete process.env.FLW_SECRET_KEY;
    vi.restoreAllMocks();
  });

  it.each(['v3', 'v4'])('%s with --tools=all', async (version) => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.FLW_API_VERSION = version;
    if (version === 'v3') process.env.FLW_SECRET_KEY = 'FLWSECK_TEST-abc-X';
    const { server, startServer } = await import('../server.js');
    await startServer({ tools: ['all'] });
    const names = Object.keys(registeredTools(server));
    for (const tool of REMOVED) expect(names).not.toContain(tool);
    if (version === 'v3') expect(names).toContain('charge_tokenized_card');
  });
});

describe('2. BVN tools: match / no-match only, confirmation before a BVN is sent', () => {
  it('initiate_bvn_verification is confirmed like a money tool, with no cap', () => {
    expect(CONFIRMED_WRITES.has('initiate_bvn_verification')).toBe(true);
    expect(capError({ bvn: '22415929481' }, { ...v3Test, FLW_MAX_AMOUNT: '10' }, 'initiate_bvn_verification')).toBeNull();
    expect(categoryOf('initiate_bvn_verification')).toBe('identity');
  });

  it('initiate_bvn_verification never runs on the first call', async () => {
    const server = new McpServer({ name: 't', version: '0' });
    const ran = vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'sent' }] }));
    server.tool('initiate_bvn_verification', 'x', { bvn: z.string(), firstname: z.string() }, ran);
    applyToolPolicy(server, {});
    const out = await (registeredTools(server).initiate_bvn_verification.handler as (a: unknown, e: unknown) => Promise<{ content: Array<{ text: string }> }>)(
      { bvn: '22415929481', firstname: 'Ada' },
      {},
    );
    expect(ran).not.toHaveBeenCalled();
    const text = out.content.map((c) => c.text).join('\n');
    expect(text).toContain('confirmation_required');
    expect(text).not.toContain('22415929481');
  });

  it('get_bvn_details answers match / no-match and never returns identity data', async () => {
    const record = {
      status: 'success',
      data: {
        status: 'COMPLETED',
        first_name: 'Ada',
        last_name: 'Obi',
        bvn_data: {
          bvn: '22415929481', firstName: 'Adá', surname: 'Obi', dateOfBirth: '01-Jan-1990', gender: 'Female',
          phoneNumber1: '08030000000', email: 'ada@example.com', nin: '12345678901', stateOfOrigin: 'Lagos',
          watchlisted: true, base64Image: 'aGVsbG8=',
        },
      },
    };
    const verification = (await import('../client/lib/verification.js')).default;
    const spy = vi.spyOn(verification, 'getBvnDetails').mockResolvedValue(record as never);
    const { getBvnDetails } = await import('../tools/verification.js');

    const ok = await getBvnDetails({ reference: 'r1', expected_first_name: ' ada ', expected_last_name: 'OBI', expected_date_of_birth: '1990-01-01' });
    const okBody = JSON.parse(ok.content[0].text);
    expect(okBody).toEqual({ reference: 'r1', status: 'COMPLETED', match: true, fields: { first_name: 'match', last_name: 'match', date_of_birth: 'match' } });

    const no = await getBvnDetails({ reference: 'r1', expected_first_name: 'Ada', expected_last_name: 'Okafor' });
    expect(JSON.parse(no.content[0].text).match).toBe(false);

    for (const out of [ok, no]) {
      const text = JSON.stringify(out);
      expect(out.content).toHaveLength(1); // no UI card
      for (const leak of ['22415929481', 'Adá', 'Female', '08030000000', 'ada@example.com', '12345678901', 'Lagos', 'watchlist', 'aGVsbG8=', '1990']) {
        expect(text).not.toContain(leak);
      }
    }
    spy.mockRestore();
  });

  it('get_bvn_details gives no answer before consent', async () => {
    const verification = (await import('../client/lib/verification.js')).default;
    const spy = vi.spyOn(verification, 'getBvnDetails').mockResolvedValue({ data: { status: 'PENDING' } } as never);
    const { getBvnDetails } = await import('../tools/verification.js');
    const out = await getBvnDetails({ reference: 'r2', expected_first_name: 'A', expected_last_name: 'B' });
    expect(JSON.parse(out.content[0].text).match).toBeNull();
    spy.mockRestore();
  });
});

describe('tokenised charge of a 3DS-saved card', () => {
  it('is a classified money-moving tool in the collections category', () => {
    expect(MONEY_MOVING.has('charge_tokenized_card')).toBe(true);
    expect(isClassified('charge_tokenized_card')).toBe(true);
    expect(categoryOf('charge_tokenized_card')).toBe('collections');
  });

  it('takes a token, never card data', () => {
    const keys = Object.keys(ChargeTokenizedCardSchema);
    expect(keys).toContain('token');
    for (const field of ['card_number', 'cvv', 'expiry_month', 'expiry_year', 'pin', 'authorization']) {
      expect(keys).not.toContain(field);
    }
  });

  it('reads the redirect from any of the three fields V3 uses', () => {
    expect(redirectUrlOf({ meta: { authorization: { redirect: 'https://a.example/3ds' } } })).toBe('https://a.example/3ds');
    expect(redirectUrlOf({ data: { meta: { authorization: { redirect: 'https://b.example/3ds' } } } })).toBe('https://b.example/3ds');
    expect(redirectUrlOf({ meta: { authorization: { redirect_url: 'https://c.example/wave' } } })).toBe('https://c.example/wave');
    expect(redirectUrlOf({ data: { status: 'successful' } })).toBe('');
  });
});

describe('3. keys from the OS keychain', () => {
  it('does nothing unless FLW_KEY_SOURCE=keychain', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(loadKeychain(env, () => 'x')).toEqual([]);
    expect(env.FLW_SECRET_KEY).toBeUndefined();
  });

  it('loads the credentials it finds', () => {
    const env: NodeJS.ProcessEnv = { FLW_KEY_SOURCE: 'keychain' };
    const store: Record<string, string> = { FLW_SECRET_KEY: 'FLWSECK_TEST-k-X', FLW_SECRET_HASH: 'h' };
    expect(loadKeychain(env, (a) => store[a])).toEqual(['FLW_SECRET_KEY', 'FLW_SECRET_HASH']);
    expect(env.FLW_SECRET_KEY).toBe('FLWSECK_TEST-k-X');
  });

  it('refuses a credential set in both places', () => {
    const env: NodeJS.ProcessEnv = { FLW_KEY_SOURCE: 'keychain', FLW_SECRET_KEY: 'FLWSECK_TEST-env-X' };
    expect(() => loadKeychain(env, () => 'x')).toThrow(/also set in the environment/);
  });

  it('refuses an empty keychain', () => {
    expect(() => loadKeychain({ FLW_KEY_SOURCE: 'keychain' }, () => undefined)).toThrow(/no credentials were found/);
  });

  it('only reads credentials, never safety switches', () => {
    for (const name of KEYCHAIN_SETTINGS) expect(name).not.toMatch(/CONFIRM|MAX_AMOUNT|READ_ONLY|APPROVED|ALLOWED/);
  });

  it('refuses odd account names before running any OS tool', () => {
    expect(osKeychainReader('linux')('FLW_SECRET_KEY; rm -rf /')).toBeUndefined();
  });
});

describe('4. live mode conditions', () => {
  const good: NodeJS.ProcessEnv = {
    ...v3Live,
    FLW_KEY_SOURCE: 'keychain',
    FLW_LIVE_APPROVED_CATEGORIES: 'payouts',
    FLW_MAX_AMOUNT_NGN: '5000',
    FLW_ALLOWED_URL_HOSTS: 'merchant.example',
  };
  const request = { tools: ['create_transfer', 'get_transfer'], readOnlyFlag: false };

  it('is still off in code', () => {
    expect(LIVE_MODE_APPROVED).toBe(false);
  });

  it('a configuration meeting every condition is still refused, and says so', () => {
    expect(liveConditionProblems(request, good)).toEqual([]);
    expect(() => assertTestCredentials('v3', good, request)).toThrow(/Live mode is disabled.*All live conditions are met/);
  });

  it.each([
    ['--tools=all', { tools: ['all'], readOnlyFlag: false }, {}, /--tools=all is not allowed/],
    ['keys from env', request, { FLW_KEY_SOURCE: undefined }, /OS keychain/],
    ['read-only by default', { tools: ['create_transfer'] }, {}, /read-only unless --read-only=false/],
    ['category not approved', { tools: ['create_refund'], readOnlyFlag: false }, {}, /not approved: refunds/],
    ['FLW_CONFIRM=false', request, { FLW_CONFIRM: 'false' }, /FLW_CONFIRM=false is refused/],
    ['no per-currency cap', request, { FLW_MAX_AMOUNT_NGN: undefined, FLW_MAX_AMOUNT: '5000' }, /cap for every currency/],
    ['elicitation switched off', request, { FLW_REQUIRE_ELICITATION: 'false' }, /need a client that asks/],
    ['no URL hosts', request, { FLW_ALLOWED_URL_HOSTS: '' }, /FLW_ALLOWED_URL_HOSTS/],
  ])('reports %s', (_label, req, change, pattern) => {
    const env = { ...good, ...change } as NodeJS.ProcessEnv;
    for (const [k, v] of Object.entries(change)) if (v === undefined) delete env[k];
    expect(liveConditionProblems(req, env).join(' ')).toMatch(pattern);
    expect(() => assertTestCredentials('v3', env, req)).toThrow(pattern);
  });

  it('FLW_KEY_SOURCE=env is an explicit opt-out from the keychain', () => {
    expect(liveConditionProblems(request, { ...good, FLW_KEY_SOURCE: 'env' })).toEqual([]);
  });

  it('a read-only live setup needs no money approvals', () => {
    expect(liveConditionProblems({ tools: ['get_transfer', 'verify_payment'] }, { ...good, FLW_LIVE_APPROVED_CATEGORIES: '' })).toEqual([]);
  });

  it('parseArgs lists the unmet conditions for live keys', () => {
    expect(() => parseArgs(['--tools=all'], v3Live)).toThrow(/Live conditions not met yet:.*--tools=all/);
  });

  it('every money-moving tool has a category', () => {
    const categorised = new Set(Object.values(MONEY_CATEGORIES).flat());
    expect([...MONEY_MOVING, ...CONFIRMED_WRITES].filter((t) => !categorised.has(t))).toEqual([]);
  });

  it('live per-call cap: FLW_MAX_AMOUNT alone is not enough', () => {
    const env = { ...v3Live, FLW_MAX_AMOUNT: '100000' };
    expect(capError({ amount: 10, currency: 'NGN' }, env, 'create_transfer')).toMatch(/live mode needs FLW_MAX_AMOUNT_NGN/);
    expect(capError({ amount: 10, currency: 'NGN' }, { ...env, FLW_MAX_AMOUNT_NGN: '50' }, 'create_transfer')).toBeNull();
    expect(capError({ amount: 60, currency: 'NGN' }, { ...env, FLW_MAX_AMOUNT_NGN: '50' }, 'create_transfer')).toMatch(/above the cap/);
  });
});
