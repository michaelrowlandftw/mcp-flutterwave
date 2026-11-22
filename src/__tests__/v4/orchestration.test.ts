import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFlwV4Fetch = vi.fn();

vi.mock('../../client/v4/http.js', () => ({
  flwV4Fetch: mockFlwV4Fetch,
}));

const ENV_KEYS = [
  'FLW_API_VERSION',
  'FLW_CLIENT_ID',
  'FLW_CLIENT_SECRET',
  'FLW_SECRET_KEY',
] as const;

describe('orchestration tools', () => {
  const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
    {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key];
    }
    vi.resetModules();
    mockFlwV4Fetch.mockReset();
    process.env.FLW_API_VERSION = 'v4';
    process.env.FLW_CLIENT_ID = 'test-client-id';
    process.env.FLW_CLIENT_SECRET = 'test-client-secret';
    mockFlwV4Fetch.mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', data: { id: 'rate_1' } }), {
        status: 201,
      }),
    );
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = savedEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('quotes a transfer rate', async () => {
    const { quoteTransferRate } = await import(
      '../../tools/v4/quoteTransferRate.js'
    );
    await quoteTransferRate({
      source: { currency: 'NGN' },
      destination: { currency: 'USD', amount: 100 },
    });
    const [path, init] = mockFlwV4Fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/transfers/rates');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      source: { currency: 'NGN' },
      destination: { currency: 'USD', amount: 100 },
    });
  });

  it('rejects a transfer rate with an unknown currency', async () => {
    const { quoteTransferRate } = await import(
      '../../tools/v4/quoteTransferRate.js'
    );
    await expect(
      quoteTransferRate({
        source: { currency: 'NGN' },
        destination: { currency: 'NOPE', amount: 100 },
      }),
    ).rejects.toThrow('tool schema validation');
    expect(mockFlwV4Fetch).not.toHaveBeenCalled();
  });

  it('gets a transfer rate by id', async () => {
    const { getTransferRate } = await import('../../tools/v4/getTransferRate.js');
    await getTransferRate({ id: 'rate_1' });
    expect(mockFlwV4Fetch).toHaveBeenCalledWith('/transfers/rates/rate_1', {
      method: 'GET',
    });
  });

  it('creates an orchestrator bank transfer', async () => {
    const { createOrchestratorTransfer } = await import(
      '../../tools/v4/createOrchestratorTransfer.js'
    );
    await createOrchestratorTransfer({
      type: 'bank',
      action: 'instant',
      reference: 'trf-ref-1',
      payment_instruction: {
        destination_currency: 'NGN',
        source_currency: 'NGN',
        amount: { value: 100, applies_to: 'destination_currency' },
        recipient: {
          bank: { account_number: '0123456789', code: '044' },
        },
      },
    });
    const [path, init] = mockFlwV4Fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/direct-transfers');
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: 'bank',
      action: 'instant',
      reference: 'trf-ref-1',
    });
  });

  it('rejects an orchestrator transfer that misses the instruction', async () => {
    const { createOrchestratorTransfer } = await import(
      '../../tools/v4/createOrchestratorTransfer.js'
    );
    await expect(
      createOrchestratorTransfer({
        type: 'bank',
        action: 'instant',
        payment_instruction: { destination_currency: 'NGN' },
      }),
    ).rejects.toThrow('generated schema validation');
    expect(mockFlwV4Fetch).not.toHaveBeenCalled();
  });

  it('resends a webhook', async () => {
    const { resendWebhook } = await import('../../tools/v4/resendWebhook.js');
    await resendWebhook({ id: 'chg_1', type: 'charge.completed' });
    const [path, init] = mockFlwV4Fetch.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/resend-webhook');
    expect(JSON.parse(String(init.body))).toEqual({
      id: 'chg_1',
      type: 'charge.completed',
    });
  });

  it('returns isError when a rate quote fails', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 400 }));
    const { handleQuoteTransferRate } = await import(
      '../../tools/v4/register.js'
    );
    const result = await handleQuoteTransferRate({
      source: { currency: 'NGN' },
      destination: { currency: 'USD', amount: 100 },
    });
    expect('isError' in result && result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('400');
  });

  it('throws when a rate quote returns a non-OK response', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 400 }));
    const { quoteTransferRate } = await import(
      '../../tools/v4/quoteTransferRate.js'
    );
    await expect(
      quoteTransferRate({
        source: { currency: 'NGN' },
        destination: { currency: 'USD', amount: 100 },
      }),
    ).rejects.toThrow('Flutterwave v4 quote transfer rate request failed: 400');
  });

  it('rejects an empty transfer rate id before calling the API', async () => {
    const { getTransferRate } = await import('../../tools/v4/getTransferRate.js');
    await expect(getTransferRate({ id: '' })).rejects.toThrow(
      'tool schema validation',
    );
    expect(mockFlwV4Fetch).not.toHaveBeenCalled();
  });

  it('encodes the transfer rate id into the request path', async () => {
    const { getTransferRate } = await import('../../tools/v4/getTransferRate.js');
    await getTransferRate({ id: 'rex_/weird id' });
    expect(mockFlwV4Fetch).toHaveBeenCalledWith(
      '/transfers/rates/rex_%2Fweird%20id',
      { method: 'GET' },
    );
  });

  it('throws when getting a transfer rate returns a non-OK response', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const { getTransferRate } = await import('../../tools/v4/getTransferRate.js');
    await expect(getTransferRate({ id: 'rex_missing' })).rejects.toThrow(
      'Flutterwave v4 get transfer rate request failed: 404',
    );
  });

  it('returns isError when getting a transfer rate fails', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const { handleGetTransferRate } = await import('../../tools/v4/register.js');
    const result = await handleGetTransferRate({ id: 'rex_missing' });
    expect('isError' in result && result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('404');
  });

  it('throws when an orchestrator transfer returns a non-OK response', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 400 }));
    const { createOrchestratorTransfer } = await import(
      '../../tools/v4/createOrchestratorTransfer.js'
    );
    await expect(
      createOrchestratorTransfer({
        type: 'bank',
        action: 'instant',
        reference: 'trf-ref-1',
        payment_instruction: {
          destination_currency: 'NGN',
          source_currency: 'NGN',
          amount: { value: 100, applies_to: 'destination_currency' },
          recipient: { bank: { account_number: '0123456789', code: '044' } },
        },
      }),
    ).rejects.toThrow(
      'Flutterwave v4 create orchestrator transfer request failed: 400',
    );
  });

  it('returns isError when an orchestrator transfer fails', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 400 }));
    const { handleCreateOrchestratorTransfer } = await import(
      '../../tools/v4/register.js'
    );
    const result = await handleCreateOrchestratorTransfer({
      type: 'bank',
      action: 'instant',
      reference: 'trf-ref-1',
      payment_instruction: {
        destination_currency: 'NGN',
        source_currency: 'NGN',
        amount: { value: 100, applies_to: 'destination_currency' },
        recipient: { bank: { account_number: '0123456789', code: '044' } },
      },
    });
    expect('isError' in result && result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('400');
  });

  it('throws when resending a webhook returns a non-OK response', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const { resendWebhook } = await import('../../tools/v4/resendWebhook.js');
    await expect(
      resendWebhook({ id: 'chg_1', type: 'charge.completed' }),
    ).rejects.toThrow('Flutterwave v4 resend webhook request failed: 404');
  });

  it('returns isError when resending a webhook fails', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const { handleResendWebhook } = await import('../../tools/v4/register.js');
    const result = await handleResendWebhook({
      id: 'chg_1',
      type: 'charge.completed',
    });
    expect('isError' in result && result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('404');
  });
});
