import { z } from 'zod';
import { newReference, RETRY_GUIDANCE } from '../../utils/reference.js';
import { safeCreate, lookupTransfer } from './safeCreate.js';
import { TransfersPostBody } from '../../client/generated/v4/transfers.zod.js';

const instruction = TransfersPostBody.shape.payment_instruction;

export const CreateTransferSchema = {
  action: TransfersPostBody.shape.action,
  reference: TransfersPostBody.shape.reference.optional().describe(
    `Unique reference for this create. ${RETRY_GUIDANCE}`,
  ),
  narration: TransfersPostBody.shape.narration,
  disburse_option: TransfersPostBody.shape.disburse_option,
  callback_url: TransfersPostBody.shape.callback_url,
  meta: TransfersPostBody.shape.meta,
  payment_instruction: z.object({
    source_currency: instruction.shape.source_currency,
    amount: instruction.shape.amount,
    recipient_id: z
      .string()
      .min(1)
      .describe('The ID of the recipient receiving the payment.'),
    sender_id: z.string().min(1).optional().describe('The ID of the sender.'),
  }),
};

export type CreateTransferArgs = {
  action: 'instant' | 'deferred' | 'scheduled';
  reference?: string;
  narration?: string;
  disburse_option?: { date_time?: string; timezone?: string };
  callback_url?: string;
  meta?: Record<string, string>;
  payment_instruction: {
    source_currency: string;
    amount: { value: number; applies_to: 'destination_currency' | 'source_currency' };
    recipient_id: string;
    sender_id?: string;
  };
};

export async function createTransfer(args: CreateTransferArgs) {
  args = { ...args, reference: args.reference ?? newReference() };
  const strict = z.object(CreateTransferSchema).safeParse(args);
  if (!strict.success) {
    throw new Error(
      `Transfer failed tool schema validation: ${strict.error.message}`,
    );
  }

  if (strict.data.action === 'scheduled' && !strict.data.disburse_option) {
    throw new Error(
      'Transfer failed tool schema validation: disburse_option is required when action is scheduled',
    );
  }

  const body = TransfersPostBody.safeParse(args);
  if (!body.success) {
    throw new Error(
      `Transfer body failed generated schema validation: ${body.error.message}`,
    );
  }

  return safeCreate({
    path: '/transfers',
    body: body.data,
    label: 'create transfer',
    reference: (body.data as { reference?: string }).reference,
    lookup: lookupTransfer,
    lookupHint: 'Check with list_transfers for today, matching the reference, or get_transfer.',
  });
}
