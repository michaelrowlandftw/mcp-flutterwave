/**
 * What to do next with a payment or payout that is not final yet.
 *
 * The server does not poll in the background (an MCP server over stdio only runs
 * while the AI client is open), so every verify result says when to check again
 * and when to escalate. The integrator's own system should run the polling.
 *
 * Rules (Flutterwave integration guidance):
 * - Poll with exponential backoff and jitter: the wait grows with the payment's
 *   age (about a quarter of it), between 30 seconds and 1 hour, with up to +/-20%
 *   random jitter so many clients don't poll at the same moment.
 * - Escalate a status that is still pending or unknown after 48 hours to
 *   Flutterwave support, with the reference and ID.
 * - Cash pickup payouts are final only when the recipient collects the cash,
 *   which can take up to 30 days. They escalate after 30 days, not 48 hours.
 */

export const MIN_WAIT_S = 30;
export const MAX_WAIT_S = 3600;
export const ESCALATE_AFTER_H = 48;
export const CASH_PICKUP_ESCALATE_AFTER_D = 30;

export type FollowUp = {
  final: boolean;
  next_check_after_seconds?: number;
  age_hours?: number;
  escalate: boolean;
  escalate_after_hours?: number;
  guidance: string;
};

type Rec = Record<string, unknown>;

const EARLIEST = Date.parse('2016-01-01T00:00:00Z');
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Creation time from v3 (created_at) or v4 (created_datetime) records. Accepts
 * ISO 8601 with a time zone, or an epoch number in seconds or milliseconds.
 * Anything else, or a time before 2016 or more than 5 minutes ahead, is ignored.
 */
export function createdAt(record: Rec, now = Date.now()): number | undefined {
  for (const key of ['created_datetime', 'created_at', 'createdAt']) {
    const v = record[key];
    let t = NaN;
    if (typeof v === 'number' && Number.isFinite(v)) t = v < 1e11 ? v * 1000 : v;
    else if (typeof v === 'string' && ISO_WITH_ZONE.test(v.trim())) t = Date.parse(v.trim());
    if (Number.isFinite(t) && t >= EARLIEST && t <= now + 5 * 60_000) return t;
  }
  return undefined;
}

/** Only plain reference characters go into guidance text the model reads. */
const safeRef = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && /^[A-Za-z0-9_.-]{1,64}$/.test(String(v)) ? String(v) : '';

export function isCashPickup(record: Rec): boolean {
  const instruction = record.payment_instruction as Rec | undefined;
  return [record.type, record.destination_type, instruction?.type].some((v) => String(v ?? '').toLowerCase() === 'cash_pickup');
}

/**
 * firstSeen: when the caller first saw this payment pending, if the record has no
 * usable creation time. Without either, the age is unknown and escalation can't
 * be timed; the result says so.
 */
export function followUp(record: Rec, final: boolean, now = Date.now(), random = Math.random, firstSeen?: number): FollowUp {
  if (final) {
    return { final: true, escalate: false, guidance: 'Final status. No more checks needed (a successful payout can still be reversed later; a reversal webhook will say so).' };
  }
  const cash = isCashPickup(record);
  const escalateAfterH = cash ? CASH_PICKUP_ESCALATE_AFTER_D * 24 : ESCALATE_AFTER_H;
  const created = createdAt(record, now) ?? firstSeen;
  const ageS = created === undefined ? 0 : Math.max(0, (now - created) / 1000);
  // Jitter first, then clamp, so the wait stays within 30 s to 1 hour.
  const wait = Math.round(Math.min(MAX_WAIT_S, Math.max(MIN_WAIT_S, (ageS / 4) * (0.8 + 0.4 * random()))));
  const ageH = ageS / 3600;
  const escalate = created !== undefined && ageH >= escalateAfterH;
  const reference = safeRef(record.reference) || safeRef(record.tx_ref) || safeRef(record.id);
  return {
    final: false,
    next_check_after_seconds: wait,
    age_hours: created === undefined ? undefined : Math.round(ageH * 10) / 10,
    escalate,
    escalate_after_hours: escalateAfterH,
    guidance: escalate
      ? `Still not final after ${Math.floor(ageH)} hours. Escalate to Flutterwave support with the reference${reference ? ` (${reference})` : ''} and ID. Do not resend the payment.`
      : `${cash ? 'Cash pickup: final only when the recipient collects the cash, which can take up to 30 days. ' : ''}Check again in about ${wait} seconds (the wait grows with age, up to 1 hour). Do not resend. If it is still not final after ${cash ? '30 days' : '48 hours'}, escalate to Flutterwave support.${created === undefined ? ' The record has no usable creation time, so the age is unknown and escalation cannot be timed: note when you first saw it pending and escalate 48 hours after that.' : ''}`,
  };
}
