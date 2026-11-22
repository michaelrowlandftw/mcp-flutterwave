import { loadEnvFile } from './loadEnv.js';
import { loadKeychain } from './keychain.js';
import { parseFlutterwaveEnv } from './env.js';

export { parseFlutterwaveEnv } from './env.js';
export type { FlutterwaveConfig } from './env.js';

loadEnvFile();
// FLW_KEY_SOURCE=keychain: credentials come from the OS keychain (the default for live mode).
loadKeychain();

export const config = parseFlutterwaveEnv(process.env);
