import { randomUUID } from 'node:crypto';
import { getAccessToken, invalidateAccessTokenCache } from './auth.js';
import { getV4BaseUrl } from './environment.js';
import { setUsageHeaders } from '../../config/userAgent.js';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Test-only fault switch for the sandbox: FLW_FAULT=timeout|503_no_id, optionally
 * for one path (FLW_FAULT=503_no_id@/transfers). The request is still sent, so the
 * record may be created, then the response is replaced by a timeout or a 503 with
 * no body. Fires once per path per process. Ignored outside the sandbox.
 */
const firedFaults = new Set<string>();

function faultFor(path: string, method: string): 'timeout' | '503_no_id' | null {
  const raw = process.env.FLW_FAULT;
  if (!raw || method !== 'POST') return null;
  const [kind, onlyPath] = raw.split('@');
  if (kind !== 'timeout' && kind !== '503_no_id') return null;
  if (onlyPath && !path.startsWith(onlyPath)) return null;
  if (getV4BaseUrl().indexOf('developersandbox') < 0) {
    console.error('FLW_FAULT is ignored outside the sandbox.');
    return null;
  }
  const key = `${kind}@${path.split('?')[0]}`;
  if (firedFaults.has(key)) return null;
  firedFaults.add(key);
  return kind;
}

/** Reset the fault switch between tests. */
export function resetFaults(): void {
  firedFaults.clear();
}

async function performFetch(
  path: string,
  init: RequestInit | undefined,
  token: string,
): Promise<Response> {
  const baseUrl = getV4BaseUrl();
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? 'GET').toUpperCase();

  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  setUsageHeaders(headers);
  // Every POST carries an idempotency key, so a resend is processed once.
  if (method === 'POST' && !headers.has('X-Idempotency-Key')) {
    headers.set('X-Idempotency-Key', `mcp-idem-${randomUUID()}`);
  }

  const timeoutMs = Number(process.env.FLW_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
      signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Network error while calling Flutterwave v4 API (${path}): ${message}`,
      { cause: error },
    );
  }

  const fault = faultFor(path, method);
  if (fault === 'timeout') {
    throw new Error(`Network error while calling Flutterwave v4 API (${path}): simulated timeout (FLW_FAULT)`);
  }
  if (fault === '503_no_id') {
    return new Response('', { status: 503 });
  }
  return response;
}

export async function flwV4Fetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const token = await getAccessToken();
  const response = await performFetch(path, init, token);

  if (response.status !== 401) {
    return response;
  }

  invalidateAccessTokenCache();
  const refreshedToken = await getAccessToken();
  return performFetch(path, init, refreshedToken);
}
