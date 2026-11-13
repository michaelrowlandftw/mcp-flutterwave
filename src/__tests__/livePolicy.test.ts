import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../cli.js';

const v3Test = { FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'FLWSECK_TEST-abc-X' };
const v3Live = { FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'FLWSECK-abc-X' };
const v4Prod = { FLW_API_VERSION: 'v4', FLW_ENVIRONMENT: 'production' };

describe('test mode only', () => {
  it('accepts a v3 test key', () => {
    expect(() => parseArgs(['--tools=all'], v3Test)).not.toThrow();
  });

  it('refuses a v3 live key with a clear message', () => {
    expect(() => parseArgs(['--tools=all'], v3Live)).toThrow(
      /not a test key.*Live mode is disabled until the security review is complete/,
    );
  });

  it('refuses v4 production', () => {
    expect(() => parseArgs(['--tools=all'], v4Prod)).toThrow(
      /FLW_ENVIRONMENT=production.*Live mode is disabled/,
    );
  });

  it('accepts v4 sandbox (default)', () => {
    expect(() => parseArgs(['--tools=all'], { FLW_API_VERSION: 'v4' })).not.toThrow();
  });

  it('has no switch that re-enables live keys', () => {
    expect(() => parseArgs(['--tools=all', '--allow-live'], v3Test)).toThrow(/Invalid argument: allow-live/);
    for (const env of [v3Live, v4Prod]) {
      expect(() => parseArgs(['--tools=all'], { ...env, FLW_ALLOW_LIVE: 'true' })).toThrow(/Live mode is disabled/);
      expect(() => parseArgs(['--tools=all', '--read-only'], env)).toThrow(/Live mode is disabled/);
    }
  });

  it('still reports a missing v3 key as missing', () => {
    expect(() => parseArgs(['--tools=all'], { FLW_API_VERSION: 'v3' })).toThrow(/Secret key not provided/);
  });
});

describe('raw card tool switch', () => {
  it('refuses a raw card tool named in --tools without the switch', () => {
    expect(() => parseArgs(['--tools=charge_card,read_transaction'], v3Test)).toThrow(
      /charge_card take raw card data.*--enable-raw-card-tools/,
    );
  });

  it.each([
    [['--tools=charge_card', '--enable-raw-card-tools'], {}],
    [['--tools=charge_card'], { FLW_ENABLE_RAW_CARD_TOOLS: 'true' }],
  ])('accepts it with the switch and warns (%j)', (args, extra) => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseArgs(args, { ...v3Test, ...extra }).rawCardTools).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/raw card tools are on/));
    warn.mockRestore();
  });

  it('is off by default', () => {
    expect(parseArgs(['--tools=all'], v3Test).rawCardTools).toBe(false);
  });
});

describe('read-only mode', () => {
  const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('is off by default', () => {
    expect(parseArgs(['--tools=all'], v3Test).readOnly).toBe(false);
  });

  it('can be turned on in test mode', () => {
    const warn = quiet();
    expect(parseArgs(['--tools=all', '--read-only'], v3Test).readOnly).toBe(true);
    expect(parseArgs(['--tools=all'], { ...v3Test, FLW_READ_ONLY: 'true' }).readOnly).toBe(true);
    warn.mockRestore();
  });

  it('refuses write tools named in --tools', () => {
    const warn = quiet();
    expect(() => parseArgs(['--tools=read_transaction,create_transfer', '--read-only'], v3Test)).toThrow(
      /cannot be registered: create_transfer.*--read-only=false/,
    );
    expect(parseArgs(['--tools=read_transaction', '--read-only'], v3Test).readOnly).toBe(true);
    warn.mockRestore();
  });

  it('rejects a bad --read-only value', () => {
    expect(() => parseArgs(['--tools=all', '--read-only=yes'], v3Test)).toThrow(/--read-only takes/);
  });
});
