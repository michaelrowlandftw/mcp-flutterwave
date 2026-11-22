import { execFileSync } from 'node:child_process';

/**
 * OS keychain storage for credentials (Security review of DX-RFC-001, decided
 * 2026-11-22: the keychain is the default key store for live mode).
 *
 * FLW_KEY_SOURCE=keychain reads the credentials below from the OS keychain,
 * service "mcp-flutterwave", account = the variable name. Nothing is written:
 * the person stores the keys with the OS tool (see docs/security.md):
 *   macOS:   security add-generic-password -s mcp-flutterwave -a FLW_SECRET_KEY -w
 *   Linux:   secret-tool store --label="mcp-flutterwave FLW_SECRET_KEY" service mcp-flutterwave account FLW_SECRET_KEY
 *   Windows: PasswordVault (Credential Manager, "Web Credentials"), resource "mcp-flutterwave"
 *
 * The OS tools are run with execFile (no shell), so a name or value cannot be
 * read as a command. Windows support is untested.
 */

export const KEYCHAIN_SERVICE = 'mcp-flutterwave';

/** Credentials that may come from the keychain. Safety switches never do. */
export const KEYCHAIN_SETTINGS = ['FLW_SECRET_KEY', 'FLW_CLIENT_ID', 'FLW_CLIENT_SECRET', 'FLW_SECRET_HASH'] as const;

export type KeySource = 'env' | 'keychain';

/** Where credentials come from. Only the real environment decides (env files cannot set it). */
export function keySource(env: NodeJS.ProcessEnv = process.env): KeySource {
  return env.FLW_KEY_SOURCE === 'keychain' ? 'keychain' : 'env';
}

/** True when FLW_KEY_SOURCE=env was set on purpose (the live-mode opt-out from the keychain default). */
export function envKeysChosenExplicitly(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLW_KEY_SOURCE === 'env';
}

export type KeychainReader = (account: string) => string | undefined;

function run(cmd: string, args: string[]): string | undefined {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 });
    const value = out.replace(/\r?\n$/, '');
    return value === '' ? undefined : value;
  } catch {
    return undefined;
  }
}

/** Read one entry from the OS keychain. Returns undefined when it is missing or the tool is unavailable. */
export function osKeychainReader(platform: NodeJS.Platform = process.platform): KeychainReader {
  return (account: string) => {
    if (!/^[A-Z0-9_]+$/.test(account)) return undefined;
    if (platform === 'darwin') {
      return run('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', account, '-w']);
    }
    if (platform === 'win32') {
      const script = [
        '[void][Windows.Security.Credentials.PasswordVault,Windows.Security.Credentials,ContentType=WindowsRuntime]',
        `$c=(New-Object Windows.Security.Credentials.PasswordVault).Retrieve('${KEYCHAIN_SERVICE}','${account}')`,
        '$c.RetrievePassword()',
        '[Console]::Out.Write($c.Password)',
      ].join(';');
      return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    }
    return run('secret-tool', ['lookup', 'service', KEYCHAIN_SERVICE, 'account', account]);
  };
}

/**
 * With FLW_KEY_SOURCE=keychain, load the credentials from the keychain into the
 * process environment (where redaction already covers them). A credential that is
 * also set in the environment is refused: one source only, so nobody believes a
 * key comes from the keychain when it does not.
 * Returns the names loaded.
 */
export function loadKeychain(
  env: NodeJS.ProcessEnv = process.env,
  read: KeychainReader = osKeychainReader(),
): string[] {
  if (keySource(env) !== 'keychain') return [];
  const both = KEYCHAIN_SETTINGS.filter((name) => env[name] !== undefined && env[name] !== '');
  if (both.length > 0) {
    throw new Error(
      `FLW_KEY_SOURCE=keychain, but ${both.join(', ')} ${both.length === 1 ? 'is' : 'are'} also set in the environment or an env file. Remove ${both.length === 1 ? 'it' : 'them'}: credentials come from one place only.`,
    );
  }
  const loaded: string[] = [];
  for (const name of KEYCHAIN_SETTINGS) {
    const value = read(name);
    if (value !== undefined) {
      env[name] = value;
      loaded.push(name);
    }
  }
  if (loaded.length === 0) {
    throw new Error(
      `FLW_KEY_SOURCE=keychain, but no credentials were found in the OS keychain under service "${KEYCHAIN_SERVICE}". See docs/security.md, "Key storage".`,
    );
  }
  return loaded;
}
