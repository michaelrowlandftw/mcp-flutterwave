import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Handler tests import the full tool registry; 5s is tight under a full run.
    testTimeout: 20_000,
    // Dummy test-mode values so modules that read config at import time load.
    // Tests that need other values set them per test.
    env: {
      FLW_SECRET_KEY: 'FLWSECK_TEST-dummy-X',
      FLW_CLIENT_ID: 'test-client-id',
      FLW_CLIENT_SECRET: 'test-client-secret',
      FLW_ENCRYPTION_KEY_V4: 'dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcyEhISE=',
    },
    exclude: [...configDefaults.exclude, '**/build/**'],
  },
});
