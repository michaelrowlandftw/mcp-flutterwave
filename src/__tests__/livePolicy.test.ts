import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../cli.js';

const v3Test = { FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'FLWSECK_TEST-abc-X' };
const v3Live = { FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'FLWSECK-abc-X' };
const v4Prod = { FLW_API_VERSION: 'v4', FLW_ENVIRONMENT: 'production' };

describe('test keys only by default', () => {
  it('accepts a v3 test key', () => {
    expect(parseArgs(['--tools=all'], v3Test).allowLive).toBe(false);
  });

  it('refuses a v3 live key with a clear message', () => {
    expect(() => parseArgs(['--tools=all'], v3Live)).toThrow(
      /not a test key.*--allow-live.*FLW_ALLOW_LIVE=true/,
    );
  });

  it('refuses v4 production', () => {
    expect(() => parseArgs(['--tools=all'], v4Prod)).toThrow(
      /FLW_ENVIRONMENT=production/,
    );
  });

  it('accepts v4 sandbox (default)', () => {
    expect(() => parseArgs(['--tools=all'], { FLW_API_VERSION: 'v4' })).not.toThrow();
  });

  it.each([
    ['--allow-live flag', ['--tools=all', '--allow-live'], {}],
    ['FLW_ALLOW_LIVE=true', ['--tools=all'], { FLW_ALLOW_LIVE: 'true' }],
  ])('allows live with %s', (_label, args, extra) => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(parseArgs(args, { ...v3Live, ...extra }).allowLive).toBe(true);
    expect(parseArgs(args, { ...v4Prod, ...extra }).allowLive).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/live mode is on/));
    warn.mockRestore();
  });

  it('does not treat other FLW_ALLOW_LIVE values as on', () => {
    expect(() =>
      parseArgs(['--tools=all'], { ...v3Live, FLW_ALLOW_LIVE: '1' }),
    ).toThrow(/not a test key/);
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
