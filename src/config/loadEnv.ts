import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Settings a file may provide: credentials and the API version only. Safety
 * switches (confirmation, card tools, caps, fault and lookup settings) must come
 * from the real environment, never from a file in a folder someone else wrote.
 */
export const FILE_SETTINGS = new Set([
  'FLW_SECRET_KEY', 'FLW_CLIENT_ID', 'FLW_CLIENT_SECRET', 'FLW_ENCRYPTION_KEY', 'FLW_ENCRYPTION_KEY_V4',
  'FLW_SECRET_HASH', 'FLW_API_VERSION',
]);

/**
 * Load an env file into process.env, only when FLW_ENV_FILE names it (review M4:
 * MCP hosts often start servers inside a project folder, so the working folder's
 * .env is not trusted). Existing variables win. Lines for other settings are ignored.
 */
export function loadEnvFile(path: string | undefined = process.env.FLW_ENV_FILE): void {
  if (!path) {
    return;
  }
  path = resolve(path);
  if (!existsSync(path)) {
    console.error(`FLW_ENV_FILE points to ${path}, which does not exist.`);
    return;
  }
  const ignored: string[] = [];

  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const separator = trimmed.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!FILE_SETTINGS.has(key)) {
      ignored.push(key);
      continue;
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  if (ignored.length > 0) {
    console.error(`Ignored in ${path} (set these in the environment instead): ${ignored.join(', ')}`);
  }
}
