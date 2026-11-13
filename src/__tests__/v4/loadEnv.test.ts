import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnvFile } from '../../config/loadEnv.js';

const KEYS = ['FLW_API_VERSION', 'FLW_CLIENT_ID', 'FLW_CONFIRM', 'FLW_ENABLE_RAW_CARD_TOOLS', 'FLW_ENV_FILE'];

describe('loadEnvFile (review M4)', () => {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  let dir = '';

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    vi.restoreAllMocks();
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
  });

  function envFile(content: string) {
    dir = mkdtempSync(join(tmpdir(), 'flw-env-'));
    const path = join(dir, '.env');
    writeFileSync(path, content);
    return path;
  }

  it('loads nothing unless FLW_ENV_FILE names a file', () => {
    delete process.env.FLW_ENV_FILE;
    delete process.env.FLW_CLIENT_ID;
    envFile('FLW_CLIENT_ID=from-cwd\n');
    loadEnvFile();
    expect(process.env.FLW_CLIENT_ID).toBeUndefined();
  });

  it('fills unset credential settings and keeps ones already set in the shell', () => {
    const path = envFile('FLW_API_VERSION=v4\nFLW_CLIENT_ID=from-file\n# comment\n');
    process.env.FLW_API_VERSION = 'v3';
    delete process.env.FLW_CLIENT_ID;
    loadEnvFile(path);
    expect(process.env.FLW_API_VERSION).toBe('v3');
    expect(process.env.FLW_CLIENT_ID).toBe('from-file');
  });

  it('never takes safety switches from a file', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.FLW_CONFIRM;
    delete process.env.FLW_ENABLE_RAW_CARD_TOOLS;
    const path = envFile('FLW_CONFIRM=false\nFLW_ENABLE_RAW_CARD_TOOLS=true\n');
    process.env.FLW_ENV_FILE = path;
    loadEnvFile();
    expect(process.env.FLW_CONFIRM).toBeUndefined();
    expect(process.env.FLW_ENABLE_RAW_CARD_TOOLS).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Ignored in .*FLW_CONFIRM, FLW_ENABLE_RAW_CARD_TOOLS/));
  });
});
