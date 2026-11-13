import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { checkSignature, parseWebhook, verifyWebhook } from '../tools/webhook.js';

// Real v3 Test Mode webhooks captured 12 Nov 2026 with default dashboard settings
// (all preferences on), redacted. Their verif-hash value is the placeholder below.
const DIR = new URL('./fixtures/webhooks/v3/', import.meta.url);
const SECRET = '<temporary test value>';
const fixtures = Object.fromEntries(
  readdirSync(DIR).map((f) => [f.slice(0, 2), JSON.parse(readFileSync(new URL(f, DIR), 'utf8'))]),
) as Record<string, { headers: Record<string, string>; body: Record<string, unknown> }>;

const raw = (n: string) => JSON.stringify(fixtures[n].body);

describe('signature check', () => {
  it('accepts a v3 verif-hash equal to the secret hash (header name in any case)', () => {
    expect(checkSignature(raw('01'), fixtures['01'].headers, SECRET)).toMatchObject({ valid: true, version: 'v3' });
    expect(checkSignature('{}', { 'Verif-Hash': SECRET }, SECRET).valid).toBe(true);
  });

  it('rejects a wrong or missing v3 hash', () => {
    expect(checkSignature(raw('01'), { 'verif-hash': 'nope' }, SECRET).valid).toBe(false);
    expect(checkSignature(raw('01'), { 'verif-hash': `${SECRET}x` }, SECRET).valid).toBe(false);
    expect(checkSignature(raw('01'), {}, SECRET)).toMatchObject({ valid: false, version: null });
  });

  it('accepts a v4 flutterwave-signature HMAC of the raw body and rejects a changed body', () => {
    const body = '{"type":"charge.completed","data":{"id":"chg_1","status":"succeeded"}}';
    const sig = createHmac('sha256', 's3cret').update(body).digest('base64');
    expect(checkSignature(body, { 'flutterwave-signature': sig }, 's3cret')).toMatchObject({ valid: true, version: 'v4' });
    expect(checkSignature(body.replace('succeeded', 'failed'), { 'flutterwave-signature': sig }, 's3cret').valid).toBe(false);
    expect(checkSignature(body, { 'flutterwave-signature': sig }, 'other').valid).toBe(false);
  });
});

describe('v3 payload shapes (fixtures)', () => {
  it.each([
    ['01', 'payment', 'v3 {event, data}', 'successful', '10598477', 'REF_BT_1794050786'],
    ['02', 'payment', 'v3 {event, data}', 'successful', null, null],
    ['07', 'payment', 'v3 {event, data}', 'successful', null, null],
    ['08', 'payment', 'v3 {event, data}', 'successful', null, null],
    ['09', 'payout', 'v3 {event, data}', 'failed', null, null],
    ['04', 'bill', 'v3 {event, data}', 'pending', null, null],
  ])('fixture %s is a %s', (n, kind, shape, status, id, reference) => {
    const p = parseWebhook(fixtures[n].body, 'v3');
    expect(p).toMatchObject({ kind, shape, webhook_status_normalised: status });
    expect(p.id ?? p.reference).toBeTruthy();
    if (id) expect(p.id).toBe(id);
    if (reference) expect(p.reference).toBe(reference);
  });

  it.each([
    ['03', 'processing', 'pending'],
    ['05', 'pending-bank-transfer', 'pending'],
    ['10', 'completed-bank-transfer', 'successful'],
  ])('refund fixture %s (no event field) matches on FlwRef', (n, rawStatus, normalised) => {
    const p = parseWebhook(fixtures[n].body, 'v3');
    expect(p).toMatchObject({ kind: 'refund', webhook_status: rawStatus, webhook_status_normalised: normalised });
    expect(p.flw_ref).toBe('4647385147661794050789116');
    expect(p.flags.join(' ')).toMatch(/TransactionId is not the ID of the refunded transaction/);
  });

  it('flags the legacy format (v3 webhooks off) and still reads the IDs', () => {
    const p = parseWebhook(fixtures['06'].body, 'v3');
    expect(p).toMatchObject({ shape: 'v3 legacy (v3 webhooks off)', id: '10598477', reference: 'REF_BT_1794050786' });
    expect(p.flags.join(' ')).toMatch(/turn on "Enable v3 webhooks"/);
  });

  it('flags unknown shapes and events instead of failing', () => {
    expect(parseWebhook({ hello: 'world' }, 'v3')).toMatchObject({ kind: 'unknown', shape: 'unknown' });
    expect(parseWebhook({ event: 'subscription.cancelled', data: { id: 1 } }, 'v3').flags.join(' ')).toMatch(/Unknown v3 event/);
  });

  it('every fixture is covered by a test above', () => {
    expect(Object.keys(fixtures).sort()).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
  });
});

describe('v4 payload shapes (docs only, untested against real payloads)', () => {
  it.each([
    ['charge.completed', 'payment', 'succeeded', 'successful'],
    ['transfer.disburse', 'payout', 'SUCCESSFUL', 'successful'],
    ['transfer.reversal', 'payout', 'REVERSED', 'reversed'],
    ['order.authorization', 'payment', 'authorized', 'pending'],
  ])('%s', (type, kind, status, normalised) => {
    const p = parseWebhook({ type, data: { id: 'x_1', reference: 'r', status } }, 'v4');
    expect(p).toMatchObject({ kind, webhook_status_normalised: normalised });
    expect(p.flags.join(' ')).toMatch(/no real v4 webhook has been tested/);
  });

  it('flags unknown v4 shapes', () => {
    expect(parseWebhook({ event: 'charge.completed', data: {} }, 'v4').kind).toBe('unknown');
  });
});

const parse = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text);
const paymentCheck = (safe: boolean) =>
  vi.fn(async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ safe_to_give_value: safe, status: 'successful' }) }] }));

describe('verify_webhook', () => {
  it('stops at a bad signature and fetches nothing', async () => {
    const payment = paymentCheck(true);
    const out = parse(await verifyWebhook({ raw_body: raw('01'), headers: { 'verif-hash': 'forged' } }, { secret: SECRET, version: 'v3', payment }));
    expect(out).toMatchObject({ signature_valid: false, safe_to_give_value: false });
    expect(payment).not.toHaveBeenCalled();
  });

  it('fetches the payment from the API and uses its status, not the webhook', async () => {
    const payment = paymentCheck(false);
    const out = parse(
      await verifyWebhook(
        { raw_body: raw('02'), headers: fixtures['02'].headers, expected_amount: 100, expected_currency: 'NGN', expected_reference: 'x' },
        { secret: SECRET, version: 'v3', payment },
      ),
    );
    expect(payment).toHaveBeenCalledWith(expect.objectContaining({ id: String((fixtures['02'].body.data as { id: number }).id) }), 'v3');
    expect(out.webhook_status_normalised).toBe('successful');
    expect(out.safe_to_give_value).toBe(false); // the API check said no
  });

  it('needs expected values before saying safe', async () => {
    const out = parse(await verifyWebhook({ raw_body: raw('07'), headers: fixtures['07'].headers }, { secret: SECRET, version: 'v3', payment: paymentCheck(true) }));
    expect(out.safe_to_give_value).toBe(false);
    expect(out.next_step).toMatch(/expected_amount/);
  });

  it('flags a replayed webhook and never says safe for it', async () => {
    // Fixtures 07 and 08 are identical resends; use a unique body so earlier tests don't count.
    const body = JSON.stringify({ ...fixtures['08'].body, replay_test: true });
    const args = { raw_body: body, headers: fixtures['08'].headers, expected_amount: 1, expected_currency: 'NGN', expected_reference: 'r' };
    const deps = { secret: SECRET, version: 'v3' as const, payment: paymentCheck(true) };
    expect(parse(await verifyWebhook(args, deps)).safe_to_give_value).toBe(true);
    const again = parse(await verifyWebhook(args, deps));
    expect(again).toMatchObject({ replay_suspected: true, safe_to_give_value: false });
  });

  it('checks payouts through verify_payout', async () => {
    const payout = vi.fn(async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ safe_to_give_value: false, final: true }) }] }));
    const out = parse(await verifyWebhook({ raw_body: raw('09'), headers: fixtures['09'].headers }, { secret: SECRET, version: 'v3', payout }));
    expect(payout).toHaveBeenCalled();
    expect(out.kind).toBe('payout');
  });

  it('does not fetch when the webhook version differs from the server version', async () => {
    const payment = paymentCheck(true);
    const out = parse(await verifyWebhook({ raw_body: raw('01'), headers: fixtures['01'].headers }, { secret: SECRET, version: 'v4', payment }));
    expect(payment).not.toHaveBeenCalled();
    expect(out.next_step).toMatch(/v3 webhook but the server runs v4/);
  });

  it('needs FLW_SECRET_HASH', async () => {
    const saved = process.env.FLW_SECRET_HASH;
    delete process.env.FLW_SECRET_HASH;
    await expect(verifyWebhook({ raw_body: '{}', headers: {} })).rejects.toThrow(/FLW_SECRET_HASH/);
    if (saved !== undefined) process.env.FLW_SECRET_HASH = saved;
  });

  it('never echoes the secret or the signature', async () => {
    const out = (await verifyWebhook({ raw_body: raw('01'), headers: { 'verif-hash': 'forged-value' } }, { secret: SECRET, version: 'v3' })).content[0].text;
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('forged-value');
  });
});

describe('reversal webhooks (review M2)', () => {
  it('a signed transfer.reversal is never safe, even when the API still shows SUCCESSFUL', async () => {
    const body = JSON.stringify({ type: 'transfer.reversal', data: { id: 'trf_rev_1', status: 'REVERSED', reference: 'r' }, id: 'wbk_rev_1' });
    const sig = createHmac('sha256', 's3cret').update(body).digest('base64');
    const payout = vi.fn(async () => ({ content: [{ type: 'text' as const, text: JSON.stringify({ safe_to_give_value: true, final: true, raw_status: 'SUCCESSFUL' }) }] }));
    const out = parse(await verifyWebhook({ raw_body: body, headers: { 'flutterwave-signature': sig } }, { secret: 's3cret', version: 'v4', payout }));
    expect(payout).toHaveBeenCalled();
    expect(out.safe_to_give_value).toBe(false);
    expect(out.flags.join(' ')).toMatch(/Reversal webhook/);
  });
});
