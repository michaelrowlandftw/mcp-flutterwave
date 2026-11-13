import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Sandbox test scenarios (v4 `X-Scenario-Key`). A tool call sets the scenario
 * for the requests it makes; the HTTP client adds the header. Sandbox only.
 */
const store = new AsyncLocalStorage<string>();

export const SCENARIO_KEY = /^scenario:[a-z0-9_]+(&issuer:[a-z0-9_]+)?$/;

export function withScenario<T>(key: string | undefined, fn: () => Promise<T>): Promise<T> {
  return key ? store.run(key, fn) : fn();
}

export function currentScenario(): string | undefined {
  return store.getStore();
}
