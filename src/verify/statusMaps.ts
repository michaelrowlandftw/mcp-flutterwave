import type { ApiVersion } from '../config/apiVersion.js';

export type NormalisedStatus = 'pending' | 'successful' | 'failed' | 'reversed' | 'unknown';
export type StatusObject = 'collection' | 'order' | 'payout' | 'refund' | 'settlement';

type StatusMap = Record<string, Exclude<NormalisedStatus, 'unknown'>>;

/**
 * v3 values. The v3 spec has no status enums, only examples, so these come from
 * the docs' examples, sandbox responses and webhooks (12 Nov 2026).
 * Matching is exact: v3 collections are lower case, v3 transfers upper case.
 */
const V3: Record<StatusObject, StatusMap> = {
  collection: { successful: 'successful', pending: 'pending', failed: 'failed' },
  order: {},
  payout: {
    NEW: 'pending',
    PENDING: 'pending',
    SUCCESSFUL: 'successful',
    FAILED: 'failed',
    // Not in the docs. A transfer can be reversed after it succeeded.
    REVERSED: 'reversed',
  },
  refund: {
    // Seen in sandbox responses and refund webhooks; none of these are documented.
    processing: 'pending',
    'pending-bank-transfer': 'pending',
    'pending-momo': 'pending',
    completed: 'successful',
    'completed-bank-transfer': 'successful',
    'completed-preauth': 'successful',
    failed: 'failed',
  },
  settlement: { completed: 'successful', pending: 'pending' },
};

/** v4 values, from the documented "allowed values" (developer docs, 12 Nov 2026). */
const V4: Record<StatusObject, StatusMap> = {
  collection: { succeeded: 'successful', pending: 'pending', failed: 'failed', voided: 'failed' },
  order: {
    completed: 'successful',
    pending: 'pending',
    authorized: 'pending',
    'partially-completed': 'pending',
    voided: 'failed',
    failed: 'failed',
  },
  payout: {
    NEW: 'pending',
    PENDING: 'pending',
    INITIATED: 'pending',
    SUCCESSFUL: 'successful',
    FAILED: 'failed',
    CANCELLED: 'failed',
    // Not in the retrieve enum; v4 sends a transfer.reversal webhook.
    REVERSED: 'reversed',
  },
  refund: {
    new: 'pending',
    pending: 'pending',
    requires_action: 'pending',
    succeeded: 'successful',
    completed: 'successful',
    failed: 'failed',
    cancelled: 'failed',
  },
  settlement: {
    'disburse-pending': 'pending',
    pending: 'pending',
    reviewed: 'pending',
    approved: 'pending',
    processing: 'pending',
    flagged: 'pending',
    'on-hold': 'pending',
    completed: 'successful',
    'completed-offline': 'successful',
    failed: 'failed',
  },
};

export const STATUS_MAPS: Record<ApiVersion, Record<StatusObject, StatusMap>> = { v3: V3, v4: V4 };

/**
 * Map a raw status to the shared set. Anything not listed for that version and
 * object is "unknown", which callers must treat as pending, never as success.
 */
export function normaliseStatus(
  version: ApiVersion,
  object: StatusObject,
  raw: unknown,
): { normalised: NormalisedStatus; raw: unknown } {
  const map = STATUS_MAPS[version][object];
  const normalised =
    typeof raw === 'string' && Object.prototype.hasOwnProperty.call(map, raw) ? map[raw] : 'unknown';
  return { normalised, raw };
}
