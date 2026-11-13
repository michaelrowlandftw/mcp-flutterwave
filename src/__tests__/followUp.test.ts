import { afterEach, describe, expect, it } from 'vitest';
import { followUp, MAX_WAIT_S, MIN_WAIT_S } from '../verify/followUp.js';
import { lookupDelays } from '../tools/v4/safeCreate.js';
import { sandboxScenarios } from '../tools/sandbox.js';
import { DOCS_GUIDE } from '../resources/docsGuide.js';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;
const mid = () => 0.5; // no jitter

describe('follow-up hints for statuses that are not final', () => {
  it('says nothing more is needed for a final status', () => {
    expect(followUp({ status: 'SUCCESSFUL' }, true, NOW)).toMatchObject({ final: true, escalate: false });
  });

  it('waits longer as the payment gets older, between 30 seconds and 1 hour', () => {
    const wait = (ageMs: number) => followUp({ created_datetime: ago(ageMs) }, false, NOW, mid).next_check_after_seconds!;
    expect(wait(10_000)).toBe(MIN_WAIT_S);
    expect(wait(H)).toBe(900);
    expect(wait(10 * H)).toBe(MAX_WAIT_S);
    expect(wait(2 * H)).toBeGreaterThan(wait(H));
  });

  it('adds up to +/-20% jitter', () => {
    const at = (r: number) => followUp({ created_at: ago(H) }, false, NOW, () => r).next_check_after_seconds!;
    expect(at(0)).toBe(720);
    expect(at(1)).toBe(1080);
  });

  it('escalates to Flutterwave after 48 hours pending or unknown', () => {
    expect(followUp({ created_datetime: ago(47 * H) }, false, NOW, mid).escalate).toBe(false);
    const late = followUp({ created_datetime: ago(49 * H), reference: 'mcp-ref-1' }, false, NOW, mid);
    expect(late.escalate).toBe(true);
    expect(late.guidance).toMatch(/Escalate to Flutterwave support.*mcp-ref-1.*Do not resend/);
  });

  it('gives cash pickup up to 30 days before escalating', () => {
    const fiveDays = followUp({ type: 'cash_pickup', created_datetime: ago(5 * 24 * H) }, false, NOW, mid);
    expect(fiveDays).toMatchObject({ escalate: false, escalate_after_hours: 720 });
    expect(fiveDays.guidance).toMatch(/collects the cash.*30 days/);
    const nested = followUp({ payment_instruction: { type: 'cash_pickup' }, created_datetime: ago(31 * 24 * H) }, false, NOW, mid);
    expect(nested.escalate).toBe(true);
  });

  it('says when the age is unknown, and never escalates without it', () => {
    const f = followUp({}, false, NOW, mid);
    expect(f).toMatchObject({ escalate: false, next_check_after_seconds: MIN_WAIT_S });
    expect(f.guidance).toMatch(/age is unknown/);
  });
});

describe('lookup backoff jitter', () => {
  afterEach(() => delete process.env.FLW_LOOKUP_DELAYS_MS);

  it('jitters the default delays by up to 20%', () => {
    expect(lookupDelays(() => 0)).toEqual([1600, 4000, 8000, 16000]);
    expect(lookupDelays(() => 1)).toEqual([2400, 6000, 12000, 24000]);
  });

  it('keeps explicit delays exact (tests rely on 0)', () => {
    process.env.FLW_LOOKUP_DELAYS_MS = '0,0';
    expect(lookupDelays(() => 1)).toEqual([0, 0]);
  });
});

describe('integrator guide', () => {
  it('covers polling, timeouts, recovery without webhooks, escalation and cash pickup', () => {
    for (const phrase of ['exponential backoff and jitter', 'timeout', "Don't rely on webhooks alone", '48 hours', 'Cash pickup', '30 days']) {
      expect(DOCS_GUIDE).toContain(phrase);
    }
    expect(sandboxScenarios('v4').content[0].text).toBeTruthy();
  });
});
