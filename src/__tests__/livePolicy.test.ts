import { describe, expect, it, vi } from 'vitest';
import { parseArgs } from '../cli.js';

const v3Test = { FLW_SECRET_KEY: 'FLWSECK_TEST-abc-X' };
const v3Live = { FLW_SECRET_KEY: 'FLWSECK-abc-X' };
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
    expect(() => parseArgs(['--tools=all'], {})).toThrow(/Secret key not provided/);
  });
});
