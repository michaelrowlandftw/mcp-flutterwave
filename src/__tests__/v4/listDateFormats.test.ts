import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

// Formats from the 30 Oct and 12 Nov 2026 API checks (see test findings pack).

const mockFlwV4Fetch = vi.fn();
vi.mock('../../client/v4/http.js', () => ({ flwV4Fetch: mockFlwV4Fetch }));

const ok = () =>
  new Response(JSON.stringify({ status: 'success', data: [] }), { status: 200 });

describe('v4 list date formats', () => {
  beforeEach(() => {
    mockFlwV4Fetch.mockReset();
    mockFlwV4Fetch.mockImplementation(async () => ok());
  });

  it('wallet statement and transfers take date only and reject ISO', async () => {
    const { getWalletStatement } = await import('../../tools/v4/getWalletStatement.js');
    const { listTransfers } = await import('../../tools/v4/listTransfers.js');

    await getWalletStatement({ currency: 'NGN', from: '2026-10-21', to: '2026-10-21' });
    await listTransfers({ from: '2026-09-17', to: '2026-09-17' });
    expect(mockFlwV4Fetch).toHaveBeenCalledTimes(2);

    await expect(
      getWalletStatement({ currency: 'NGN', from: '2026-10-21T00:00:00Z' }),
    ).rejects.toThrow('generated schema validation');
    await expect(listTransfers({ to: '2026-09-17T00:00:00Z' })).rejects.toThrow(
      'generated schema validation',
    );
    expect(mockFlwV4Fetch).toHaveBeenCalledTimes(2);
  });

  it('wallet statement requires currency in the tool schema', async () => {
    const { GetWalletStatementSchema } = await import('../../tools/v4/getWalletStatement.js');
    expect(z.object(GetWalletStatementSchema).safeParse({ from: '2026-10-21' }).success).toBe(false);
  });

  it('transfers has no page parameter', async () => {
    const { ListTransfersSchema } = await import('../../tools/v4/listTransfers.js');
    expect(ListTransfersSchema).not.toHaveProperty('page');
    expect(ListTransfersSchema).toHaveProperty('next');
  });

  it.each([
    ['listCharges', '../../tools/v4/listCharges.js'],
    ['listRefunds', '../../tools/v4/listRefunds.js'],
    ['listSettlements', '../../tools/v4/listSettlements.js'],
  ])('%s takes ISO date-times and rejects date only', async (name, path) => {
    const mod = await import(path);
    await mod[name]({ from: '2026-10-21T00:00:00Z', to: '2026-10-21T09:00:00Z' });
    await expect(mod[name]({ from: '2026-10-21' })).rejects.toThrow(
      'generated schema validation',
    );
    expect(mockFlwV4Fetch).toHaveBeenCalledTimes(1);
  });

  it('charges rejects a future to before calling the API', async () => {
    const { listCharges } = await import('../../tools/v4/listCharges.js');
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await expect(listCharges({ to: future })).rejects.toThrow(/later than the current time/);
    expect(mockFlwV4Fetch).not.toHaveBeenCalled();
  });

  it('refunds and settlements accept a future to', async () => {
    const { listRefunds } = await import('../../tools/v4/listRefunds.js');
    const future = new Date(Date.now() + 3_600_000).toISOString();
    await listRefunds({ to: future });
    expect(mockFlwV4Fetch).toHaveBeenCalledTimes(1);
  });

  it('maps wallet statement 404 TRANSFER_NOT_FOUND to an empty result', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ status: 'failed', error: { type: 'TRANSFER_NOT_FOUND', code: '301404', message: 'Transfer not found' } }),
        { status: 404 },
      ),
    );
    const { getWalletStatement } = await import('../../tools/v4/getWalletStatement.js');
    const result = await getWalletStatement({ currency: 'NGN', from: '2026-11-12', to: '2026-11-12' });
    const body = JSON.parse(result.content[0].text);
    expect(body.status).toBe(200);
    expect(body.body.data).toEqual([]);
  });

  it('still fails on any other wallet statement 404', async () => {
    mockFlwV4Fetch.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const { getWalletStatement } = await import('../../tools/v4/getWalletStatement.js');
    await expect(getWalletStatement({ currency: 'NGN' })).rejects.toThrow(/request failed: 404/);
  });
});

describe('charges clock margin', () => {
  it('rejects a to within the last minute, accepts one older than a minute', async () => {
    const { notInFuture } = await import('../../tools/v4/dateParams.js');
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(() => notInFuture('2026-11-13T12:00:00Z', now)).toThrow(/at least one minute in the past/);
    expect(() => notInFuture('2026-11-13T11:59:30Z', now)).toThrow();
    expect(() => notInFuture('2026-11-13T11:58:59Z', now)).not.toThrow();
    expect(() => notInFuture(undefined, now)).not.toThrow();
  });
});
