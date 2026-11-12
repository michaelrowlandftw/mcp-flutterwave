import { z } from 'zod';

// v4 list endpoints don't share one date format (tested 30 Oct and 12 Nov 2026):
// charges, refunds and settlements need ISO 8601 date-times; transfers and the
// wallet statement need date only and reject ISO.

export function isoDateTime(edge: 'Start' | 'End', note: string) {
  return z
    .string()
    .datetime({ offset: true })
    .describe(
      `${edge} of the range, ISO 8601 date-time, for example 2026-10-21T00:00:00Z. ${note}`,
    );
}

export function dateOnly(edge: 'Start' | 'End') {
  return z
    .string()
    .date()
    .describe(
      `${edge} of the range, date only (yyyy-MM-dd), for example 2026-10-21. The day is included. ISO date-times are rejected by the API.`,
    );
}

/** Charges rejects a `to` later than now ("Query param 'to' can not be after current date"). */
export function notInFuture(value: string | undefined, now = Date.now()): void {
  if (value !== undefined && Date.parse(value) > now) {
    throw new Error(
      `'to' (${value}) is later than the current time. GET /charges rejects a future 'to'; use the current time or earlier.`,
    );
  }
}
