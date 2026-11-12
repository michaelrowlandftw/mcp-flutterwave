import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real v3 clients (openapi-fetch) with fetch mocked: a fake v3 sandbox.
type Call = { url: string; method: string; body: any };
let calls: Call[];
let store: Array<Record<string, unknown>>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Behaviour = 'ok' | '503_after_create' | '503_no_create' | 'always_503' | '400';

function fakeApi(behaviour: Behaviour) {
  return vi.fn(async (input: Request | string, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const method = request.method.toUpperCase();
    const url = new URL(request.url);
    const body = method === 'POST' ? JSON.parse(await request.text()) : undefined;
    calls.push({ url: request.url, method, body });
    if (method === 'POST') {
      const posts = calls.filter((c) => c.method === 'POST').length;
      if (behaviour === '400') return json({ status: 'error', message: 'Invalid account' }, 400);
      if (behaviour === 'always_503' || (behaviour === '503_no_create' && posts === 1)) return new Response('', { status: 503 });
      const ref = body.reference ?? body.tx_ref;
      const record = { id: store.length + 1, reference: ref, tx_ref: ref, status: 'NEW' };
      store.push(record);
      if (behaviour === '503_after_create' && posts === 1) return new Response('', { status: 503 });
      return json({ status: 'success', message: 'ok', data: record });
    }
    if (url.pathname.endsWith('/transactions/verify_by_reference')) {
      const hit = store.find((r) => r.tx_ref === url.searchParams.get('tx_ref'));
      return hit ? json({ status: 'success', data: hit }) : json({ status: 'error', message: 'No transaction was found' }, 400);
    }
    if (url.pathname.endsWith('/transfers')) {
      return json({ status: 'success', data: store.filter((r) => r.reference === url.searchParams.get('reference')) });
    }
    return json({ status: 'error' }, 404);
  });
}

const TOOLS = [
  ['createTransfer', '../tools/transfer.js', { account_bank: '044', account_number: '0690000031', amount: 100, currency: 'NGN', reference: 'mcp-transfer-ref-1' }, '/transfers'],
  ['chargeMpesa', '../tools/charge.js', { tx_ref: 'mcp-charge-ref-1', amount: '100', currency: 'KES', email: 'a@b.co', phone_number: '254700000000' }, '/transactions/verify_by_reference'],
] as const;

async function run(name: string, path: string, args: unknown) {
  const mod = await import(path);
  const result = await mod[name](args);
  const textOut = result.content[0].text as string;
  try {
    return JSON.parse(textOut);
  } catch {
    return { text: textOut };
  }
}

const posts = () => calls.filter((c) => c.method === 'POST');

describe('safe creates (v3)', () => {
  beforeEach(() => {
    vi.resetModules();
    calls = [];
    store = [];
    process.env.FLW_LOOKUP_DELAYS_MS = '0,0';
    process.env.FLW_SECRET_KEY = 'FLWSECK_TEST-unit-X';
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.FLW_LOOKUP_DELAYS_MS;
  });

  it.each(TOOLS)('%s: a normal create sends once', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('ok'));
    const out = await run(name, path, args);
    expect(out.status).not.toBe('unknown');
    expect(posts()).toHaveLength(1);
  });

  it.each(TOOLS)('%s: 503 after the record was created finds it and does not retry', async (name, path, args, lookupPath) => {
    vi.stubGlobal('fetch', fakeApi('503_after_create'));
    const out = await run(name, path, args);
    expect(out.status).toBe('found_after_uncertain_create');
    expect(store).toHaveLength(1);
    expect(posts()).toHaveLength(1);
    expect(calls.some((c) => c.method === 'GET' && c.url.includes(lookupPath))).toBe(true);
  });

  it.each(TOOLS)('%s: 503 with nothing created retries once with the same reference', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('503_no_create'));
    const out = await run(name, path, args);
    expect(out.status).not.toBe('unknown');
    expect(store).toHaveLength(1);
    const [a, b] = posts();
    expect(posts()).toHaveLength(2);
    expect(b.body.reference ?? b.body.tx_ref).toBe(a.body.reference ?? a.body.tx_ref);
  });

  it.each(TOOLS)('%s: keeps failing gives unknown after one retry', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('always_503'));
    const out = await run(name, path, args);
    expect(out.status).toBe('unknown');
    expect(out.reason).toMatch(/retried once with the same reference/);
    expect(posts()).toHaveLength(2);
  });

  it.each(TOOLS)('%s: a 4xx is a clear failure with no lookup and no retry', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('400'));
    const out = await run(name, path, args);
    expect(out.status).toBe('failed');
    expect(out.reason).toMatch(/HTTP 400/);
    expect(posts()).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0);
  });
});
