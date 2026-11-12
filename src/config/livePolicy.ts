import type { ApiVersion } from './apiVersion.js';

export const LIVE_SWITCH_HINT =
  'To use live keys on purpose, start the server with --allow-live or set FLW_ALLOW_LIVE=true.';

export function liveAllowedByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLW_ALLOW_LIVE === 'true';
}

/**
 * Refuse live credentials unless the live switch is on.
 * v3: the secret key must start with FLWSECK_TEST.
 * v4: FLW_ENVIRONMENT must not be "production".
 */
export function assertTestCredentials(
  apiVersion: ApiVersion,
  allowLive: boolean,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (allowLive) {
    return;
  }

  if (apiVersion === 'v3') {
    const key = env.FLW_SECRET_KEY ?? '';
    // A missing key gets its own error later in start-up.
    if (key !== '' && !key.startsWith('FLWSECK_TEST')) {
      throw new Error(
        `FLW_SECRET_KEY is not a test key (test keys start with "FLWSECK_TEST"). The server accepts test keys only by default. ${LIVE_SWITCH_HINT}`,
      );
    }
    return;
  }

  if (env.FLW_ENVIRONMENT === 'production') {
    throw new Error(
      `FLW_ENVIRONMENT=production points the server at live v4 APIs. The server uses the sandbox only by default. ${LIVE_SWITCH_HINT}`,
    );
  }
}
