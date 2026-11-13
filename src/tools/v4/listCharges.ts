import { z } from 'zod';
import { flwV4Fetch } from '../../client/v4/http.js';
import { ChargesListQueryParams } from '../../client/generated/v4/charges-list.zod.js';
import { toQueryString, v4JsonResult } from './httpResult.js';
import { isoDateTime, notInFuture } from './dateParams.js';

export const ListChargesSchema = {
  status: z
    .enum(['succeeded', 'pending', 'failed', 'voided'])
    .optional()
    .describe('Filter by charge status.'),
  reference: z.string().min(1).optional().describe('Filter by charge reference.'),
  customer_id: z.string().min(1).optional().describe('Filter by customer id.'),
  payment_method_id: z
    .string()
    .min(1)
    .optional()
    .describe('Filter by payment method id.'),
  virtual_account_id: z
    .string()
    .min(1)
    .optional()
    .describe('Filter by virtual account id.'),
  order_id: z.string().min(1).optional().describe('Filter by order id.'),
  from: isoDateTime('Start', 'The time of day is used, to the second (UTC).').optional(),
  to: isoDateTime(
    'End',
    'The time of day is used. Must be at least one minute before now: the API rejects a future value.',
  ).optional(),
  page: z.number().int().min(1).optional().describe('Page to retrieve.'),
  size: z
    .number()
    .int()
    .min(10)
    .max(50)
    .optional()
    .describe('Page size. Flutterwave requires 10 to 50. Defaults to 10.'),
};

export type ListChargesArgs = {
  status?: 'succeeded' | 'pending' | 'failed' | 'voided';
  reference?: string;
  customer_id?: string;
  payment_method_id?: string;
  virtual_account_id?: string;
  order_id?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
};

export async function listCharges(args: ListChargesArgs) {
  notInFuture(args.to);
  const parsed = ChargesListQueryParams.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      `Charge list query failed generated schema validation: ${parsed.error.message}`,
    );
  }

  const response = await flwV4Fetch(`/charges${toQueryString(parsed.data)}`, {
    method: 'GET',
  });
  return v4JsonResult(response, 'list charges');
}
