import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real HTTP client (fault switch, idempotency header) with fetch and auth mocked.
vi.mock('../../client/v4/auth.js', () => ({
  getAccessToken: async () => 'tok',
  invalidateAccessTokenCache: () => {},
}));

type Call = { url: string; method: string; headers: Headers; body?: string };
let calls: Call[];
let store: Array<Record<string, unknown>>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

type Behaviour = 'ok' | '503_after_create' | '503_no_create' | 'always_503';

/** A fake sandbox: POST creates a record; list GETs return what exists. */
function fakeApi(behaviour: Behaviour) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const method = (init.method ?? 'GET').toUpperCase();
    calls.push({ url, method, headers: new Headers(init.headers), body: init.body as string | undefined });
    if (method === 'POST') {
      const body = JSON.parse(String(init.body));
      const postCount = calls.filter((c) => c.method === 'POST').length;
      if (behaviour === 'always_503' || (behaviour === '503_no_create' && postCount === 1)) {
        return new Response('', { status: 503 });
      }
      const record = { id: `id_${store.length + 1}`, reference: body.reference, status: 'pending' };
      store.push(record);
      if (behaviour === '503_after_create' && postCount === 1) return new Response('', { status: 503 });
      return json({ status: 'success', data: record }, 201);
    }
    const wanted = new URL(url).searchParams.get('reference');
    const rows = store.filter((r) => !wanted || r.reference === wanted);
    if (url.includes('/transfers?')) {
      return json({ status: 'success', data: { transfers: rows, cursor: { has_more_items: false } } });
    }
    return json({ status: 'success', data: rows });
  });
}

const TOOLS = [
  ['createCharge', '../../tools/v4/createCharge.js', { amount: 100, currency: 'NGN', customer_id: 'cus_1', payment_method_id: 'pmd_1' }],
  ['createOrder', '../../tools/v4/createOrder.js', { amount: 100, currency: 'NGN', customer_id: 'cus_1', payment_method_id: 'pmd_1' }],
  ['createVirtualAccount', '../../tools/v4/createVirtualAccount.js', { customer_id: 'cus_1', currency: 'NGN', account_type: 'static', amount: 0 }],
  [
    'createTransfer',
    '../../tools/v4/createTransfer.js',
    { action: 'instant', payment_instruction: { recipient_id: 'rcb_1', source_currency: 'NGN', amount: { value: 100, applies_to: 'destination_currency' } } },
  ],
] as const;

async function run(name: string, path: string, args: unknown) {
  const mod = await import(path);
  const result = await mod[name](args);
  return JSON.parse(result.content[0].text);
}

describe('safe creates (v4)', () => {
  beforeEach(() => {
    vi.resetModules();
    calls = [];
    store = [];
    process.env.FLW_LOOKUP_DELAYS_MS = '0,0';
    delete process.env.FLW_ENVIRONMENT;
    delete process.env.FLW_FAULT;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete process.env.FLW_LOOKUP_DELAYS_MS;
    delete process.env.FLW_FAULT;
    delete process.env.FLW_ENVIRONMENT;
  });

  it.each(TOOLS)('%s generates a reference and sends it as X-Idempotency-Key', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('ok'));
    const out = await run(name, path, args);
    expect(out.status).toBe(201);
    const post = calls.find((c) => c.method === 'POST')!;
    const ref = JSON.parse(post.body!).reference;
    expect(ref).toMatch(/^mcp-[0-9a-f]{20}$/);
    expect(post.headers.get('X-Idempotency-Key')).toBe(ref);
  });

  it.each(TOOLS)('%s: 503 after the record was created gives one record and no retry', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('503_after_create'));
    const out = await run(name, path, args);
    expect(out.status).toBe('found_after_uncertain_create');
    expect(out.body.data.status).toBe('pending');
    expect(store).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it.each(TOOLS)('%s: 503 with nothing created allows one retry with the same key', async (name, path, args) => {
    vi.stubGlobal('fetch', fakeApi('503_no_create'));
    const out = await run(name, path, args);
    expect(out.status).toBe(201);
    expect(store).toHaveLength(1);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1].headers.get('X-Idempotency-Key')).toBe(posts[0].headers.get('X-Idempotency-Key'));
  });

  it('returns unknown after one retry when the API keeps failing', async () => {
    vi.stubGlobal('fetch', fakeApi('always_503'));
    const out = await run(...TOOLS[0]);
    expect(out.status).toBe('unknown');
    expect(out.retried_once).toBe(true);
    expect(out.next_step).toMatch(/Do not call this create tool again/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('keeps a caller-supplied reference', async () => {
    vi.stubGlobal('fetch', fakeApi('ok'));
    await run(TOOLS[0][0], TOOLS[0][1], { ...TOOLS[0][2], reference: 'my-ref-123456' });
    expect(calls[0].headers.get('X-Idempotency-Key')).toBe('my-ref-123456');
  });

  it('a create without a lookup returns unknown and never retries', async () => {
    vi.stubGlobal('fetch', fakeApi('always_503'));
    const { createRefund } = await import('../../tools/v4/createRefund.js');
    const result = await createRefund({ charge_id: 'chg_1', amount: 10, reason: 'requested_by_customer' } as never);
    const out = JSON.parse(result.content[0].text);
    expect(out.status).toBe('unknown');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
    expect(calls[0].headers.get('X-Idempotency-Key')).toMatch(/^mcp-idem-/);
  });

  it('a 4xx is a definite failure, not unknown', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 400 })));
    const { createCharge } = await import('../../tools/v4/createCharge.js');
    await expect(createCharge(TOOLS[0][2] as never)).rejects.toThrow('request failed: 400');
  });

  describe('FLW_FAULT test switch', () => {
    it.each(['503_no_id', 'timeout'])('%s: record created, reply lost, lookup finds it', async (fault) => {
      process.env.FLW_FAULT = `${fault}@/transfers`;
      vi.stubGlobal('fetch', fakeApi('ok'));
      const out = await run(...TOOLS[3]);
      expect(out.status).toBe('found_after_uncertain_create');
      expect(store).toHaveLength(1);
    });

    it('only fires for the named path', async () => {
      process.env.FLW_FAULT = '503_no_id@/transfers';
      vi.stubGlobal('fetch', fakeApi('ok'));
      expect((await run(...TOOLS[0])).status).toBe(201);
    });

    it('is ignored outside the sandbox', async () => {
      process.env.FLW_FAULT = '503_no_id';
      process.env.FLW_ENVIRONMENT = 'production';
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.stubGlobal('fetch', fakeApi('ok'));
      expect((await run(...TOOLS[0])).status).toBe(201);
    });
  });
});
