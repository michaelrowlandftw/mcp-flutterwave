import { getApiVersion } from '../config/apiVersion.js';

export const VERIFY_HINT =
  'Before giving value (shipping goods, crediting a wallet, marking an invoice paid), call verify_payment or verify_payout. A webhook, a redirect or a create response is a signal to check, not proof.';

export type EnvironmentInfo = {
  api_version: 'v3' | 'v4';
  environment: 'sandbox' | 'test_mode' | 'production' | 'live';
  note: string;
};

/** Which Flutterwave environment this process talks to. Added to every tool result. */
export function describeEnvironment(env: NodeJS.ProcessEnv = process.env): EnvironmentInfo {
  const apiVersion = getApiVersion(env);
  if (apiVersion === 'v4') {
    return env.FLW_ENVIRONMENT === 'production'
      ? { api_version: 'v4', environment: 'production', note: 'Live data. Real money.' }
      : {
          api_version: 'v4',
          environment: 'sandbox',
          note: 'Test data only. Sandbox statuses and data can differ from live.',
        };
  }
  return (env.FLW_SECRET_KEY ?? '').startsWith('FLWSECK_TEST')
    ? {
        api_version: 'v3',
        environment: 'test_mode',
        note: 'Test data only. v3 Test Mode creates no settlements, and refund statuses can differ from live.',
      }
    : { api_version: 'v3', environment: 'live', note: 'Live data. Real money.' };
}
