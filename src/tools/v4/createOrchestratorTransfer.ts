import { z } from 'zod';
import { newReference, RETRY_GUIDANCE } from '../../utils/reference.js';
import { safeCreate, lookupTransfer } from './safeCreate.js';
import { DirectTransfersPostBody } from '../../client/generated/v4/direct-transfers.zod.js';

export const CreateOrchestratorTransferSchema = {
  type: z
    .enum(['bank', 'mobile_money', 'wallet', 'cash_pickup', 'crypto'])
    .describe('Transfer rail.'),
  action: z
    .enum(['instant', 'deferred', 'scheduled'])
    .describe('When the transfer should be processed.'),
  reference: z
    .string()
    .min(6)
    .max(42)
    .regex(/^[a-zA-Z0-9-]+$/)
    .optional()
    .optional()
    .describe(`Unique reference for this create. ${RETRY_GUIDANCE}`),
  narration: z.string().min(1).max(180).optional(),
  callback_url: z.string().optional(),
  meta: z.record(z.string(), z.string()).optional(),
  disburse_option: z
    .object({
      date_time: z.string().optional(),
      timezone: z.string().optional(),
    })
    .optional()
    .describe('Required when action is scheduled.'),
  payment_instruction: z
    .record(z.string(), z.unknown())
    .describe(
      'Rail-specific recipient, sender, currencies, and amount. Validated against the v4 direct transfer schema.',
    ),
};

export type CreateOrchestratorTransferArgs = {
  type: 'bank' | 'mobile_money' | 'wallet' | 'cash_pickup' | 'crypto';
  action: 'instant' | 'deferred' | 'scheduled';
  reference?: string;
  narration?: string;
  callback_url?: string;
  meta?: Record<string, string>;
  disburse_option?: { date_time?: string; timezone?: string };
  payment_instruction: Record<string, unknown>;
};

export async function createOrchestratorTransfer(
  args: CreateOrchestratorTransferArgs,
) {
  args = { ...args, reference: args.reference ?? newReference() };
  const strict = z.object(CreateOrchestratorTransferSchema).safeParse(args);
  if (!strict.success) {
    throw new Error(
      `Orchestrator transfer failed tool schema validation: ${strict.error.message}`,
    );
  }

  const body = DirectTransfersPostBody.safeParse(args);
  if (!body.success) {
    throw new Error(
      `Orchestrator transfer body failed generated schema validation: ${body.error.message}`,
    );
  }

  return safeCreate({
    path: '/direct-transfers',
    body: body.data,
    label: 'create orchestrator transfer',
    reference: (body.data as { reference?: string }).reference,
    lookup: lookupTransfer,
    lookupHint: 'Check with list_transfers for today, matching the reference.',
  });
}
