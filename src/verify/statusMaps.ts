import type { ApiVersion } from '../config/apiVersion.js';

export type NormalisedStatus = 'pending' | 'successful' | 'failed' | 'reversed' | 'unknown';
export type StatusObject = 'collection' | 'order' | 'payout' | 'refund' | 'settlement';

type StatusMap = Record<string, Exclude<NormalisedStatus, 'unknown'>>;

/**
 * v3 values. The published v3 spec has no status enums. These come from the
 * candidate V3 spec (michaelrowlandftw/flutterwave-v3-openapi 0.1.0-candidate+20261122,
 * components TransactionStatus, TransferStatus, RefundStatus, SettlementStatus),
 * built from measured Test Mode and production responses, plus the docs' examples
 * and webhooks. src/__tests__/fixtures/candidate-v3-status-enums.json holds the
 * enums with their sources, and a test checks every value is mapped.
 * Matching is exact: v3 collections are lower case, v3 transfers upper case.
 */
const V3: Record<StatusObject, StatusMap> = {
  // voided: measured in Test Mode (candidate spec); final and not paid.
  collection: { successful: 'successful', pending: 'pending', failed: 'failed', voided: 'failed' },
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
    // Seen in sandbox and production responses and refund webhooks. GET /v3/refunds/{id}
    // hyphenates (completed-bank-transfer); GET /v3/refunds does not (completedbanktransfer).
    processing: 'pending',
    'pending-bank-transfer': 'pending',
    'pending-momo': 'pending',
    completed: 'successful',
    'completed-bank-transfer': 'successful',
    completedbanktransfer: 'successful',
    completedmomo: 'successful',
    completedmpgs: 'successful',
    completedoffline: 'successful',
    completedpreauth: 'successful',
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
