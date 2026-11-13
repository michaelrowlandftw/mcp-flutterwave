import type { ApiVersion } from './apiVersion.js';

export const LIVE_DISABLED =
  'Live mode is disabled until the security review is complete. Use test keys (v3) or the sandbox (v4).';

/**
 * Refuse live credentials. Nothing turns this off.
 * v3: the secret key must start with FLWSECK_TEST.
 * v4: FLW_ENVIRONMENT must not be "production".
 */
export function assertTestCredentials(
  apiVersion: ApiVersion,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (apiVersion === 'v3') {
    const key = env.FLW_SECRET_KEY ?? '';
    // A missing key gets its own error later in start-up.
    if (key !== '' && !key.startsWith('FLWSECK_TEST')) {
      throw new Error(
        `FLW_SECRET_KEY is not a test key (test keys start with "FLWSECK_TEST"). ${LIVE_DISABLED}`,
      );
    }
    return;
  }

  if (env.FLW_ENVIRONMENT === 'production') {
    throw new Error(`FLW_ENVIRONMENT=production points the server at live v4 APIs. ${LIVE_DISABLED}`);
  }
}
