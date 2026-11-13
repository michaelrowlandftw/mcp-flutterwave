export type ApiVersion = 'v3' | 'v4';

/**
 * v4 is the default. FLW_API_VERSION=v3 keeps the v3 tool set.
 * An install with only a v3 secret key (FLW_SECRET_KEY, no FLW_CLIENT_ID)
 * and no FLW_API_VERSION keeps v3, with a warning, so upgrades don't break.
 */
let warnedV3Inferred = false;

export function getApiVersion(
  env: NodeJS.ProcessEnv = process.env,
): ApiVersion {
  const value = env.FLW_API_VERSION;
  if (value === 'v3') {
    return 'v3';
  }
  if (value === 'v4') {
    return 'v4';
  }
  if (value === undefined || value === '') {
    if (env.FLW_SECRET_KEY && !env.FLW_CLIENT_ID) {
      if (!warnedV3Inferred) console.warn(
        'FLW_API_VERSION is not set and only a v3 secret key was found, so the server uses v3. Set FLW_API_VERSION=v3 to keep v3, or set FLW_CLIENT_ID and FLW_CLIENT_SECRET to move to v4 (the default).',
      );
      warnedV3Inferred = true;
      return 'v3';
    }
    return 'v4';
  }
  console.warn(
    `Unrecognized FLW_API_VERSION value "${value}", falling back to "v4". Expected "v3" or "v4".`,
  );
  return 'v4';
}
