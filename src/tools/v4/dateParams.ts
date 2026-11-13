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

/**
 * Charges rejects a `to` later than now ("Query param 'to' can not be after current date").
 * The API clock can run slightly behind ours: a `to` of exactly now was rejected in the
 * sandbox (13 Nov 2026). So `to` must be at least one minute in the past.
 */
export const CLOCK_MARGIN_MS = 60_000;

export function notInFuture(value: string | undefined, now = Date.now()): void {
  if (value !== undefined && Date.parse(value) > now - CLOCK_MARGIN_MS) {
    throw new Error(
      `'to' (${value}) is later than the current time minus one minute. GET /charges rejects a future 'to', and its clock can run slightly behind; use a time at least one minute in the past.`,
    );
  }
}
