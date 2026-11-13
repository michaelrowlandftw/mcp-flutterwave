import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { newTraceId, SERVER_VERSION, setUsageHeaders, USER_AGENT } from '../config/userAgent.js';

vi.mock('../client/v4/auth.js', () => ({ getAccessToken: async () => 'tok', invalidateAccessTokenCache: () => {} }));

describe('usage headers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('version matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
    expect(SERVER_VERSION).toBe(pkg.version);
    expect(USER_AGENT).toBe(`mcp-flutterwave/${pkg.version}`);
  });

  it('trace IDs are unique and inside the v4 length rule (12 to 255)', () => {
    const ids = new Set(Array.from({ length: 100 }, newTraceId));
    expect(ids.size).toBe(100);
    for (const id of ids) expect(id.length).toBeGreaterThanOrEqual(12), expect(id.length).toBeLessThanOrEqual(255);
  });

  it('keeps a trace ID the caller set', () => {
    const h = setUsageHeaders(new Headers({ 'X-Trace-Id': 'mine-123456789' }));
    expect(h.get('X-Trace-Id')).toBe('mine-123456789');
    expect(h.get('User-Agent')).toBe(USER_AGENT);
  });

  it('every v4 request carries User-Agent and X-Trace-Id', async () => {
    const seen: Headers[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      return new Response('{}', { status: 200 });
    }));
    const { flwV4Fetch } = await import('../client/v4/http.js');
    await flwV4Fetch('/banks?country=NG', { method: 'GET' });
    await flwV4Fetch('/customers', { method: 'POST', body: '{}' });
    for (const h of seen) {
      expect(h.get('User-Agent')).toBe(USER_AGENT);
      expect(h.get('X-Trace-Id')).toMatch(/^mcp-flutterwave-[0-9a-f-]{36}$/);
    }
    expect(seen[0].get('X-Trace-Id')).not.toBe(seen[1].get('X-Trace-Id'));
  });

  it('every v3 request carries them through the auth middleware', async () => {
    const { default: mw } = await import('../client/middleware/authMiddlewareV3.js');
    const request = new Request('https://api.flutterwave.com/v3/banks/NG');
    const out = (await mw.onRequest!({ request } as never)) as Request;
    expect(out.headers.get('User-Agent')).toBe(USER_AGENT);
    expect(out.headers.get('X-Trace-Id')).toMatch(/^mcp-flutterwave-/);
  });
});
