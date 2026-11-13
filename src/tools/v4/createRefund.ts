import { z } from 'zod';
import { safeCreate } from './safeCreate.js';
import { RefundsPostBody } from '../../client/generated/v4/refunds.zod.js';

const REFUND_REASONS = [
  'duplicate',
  'fraudulent',
  'requested_by_customer',
  'expired_uncaptured_charge',
] as const;

export const CreateRefundSchema = {
  charge_id: z.string().min(1).describe('ID of the charge to refund (chg_…).'),
  amount: z
    .number()
    .min(0.01, 'Amount must be at least 0.01')
    .describe('Amount of the refund.'),
  reason: z
    .enum(REFUND_REASONS)
    .describe('Reason for the refund.'),
  meta: z.record(z.string(), z.string()).optional(),
};

export type CreateRefundArgs = {
  charge_id: string;
  amount: number;
  reason: (typeof REFUND_REASONS)[number];
  meta?: Record<string, string>;
};

function withoutUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}

export async function createRefund(
  args: CreateRefundArgs,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const body = withoutUndefined({
    charge_id: args.charge_id,
    amount: args.amount,
    reason: args.reason,
    meta: args.meta,
  });

  const parsed = RefundsPostBody.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      `Refund payload failed generated schema validation: ${parsed.error.message}`,
    );
  }

  return safeCreate({
    path: '/refunds',
    body: parsed.data,
    label: 'refund',
    lookupHint: 'Check with get_charge or list_refunds before creating another refund.',
  });
}
