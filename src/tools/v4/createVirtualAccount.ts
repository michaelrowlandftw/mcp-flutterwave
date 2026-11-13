import { z } from 'zod';
import { newReference, RETRY_GUIDANCE } from '../../utils/reference.js';
import { safeCreate, lookupVirtualAccount } from './safeCreate.js';
import { VirtualAccountsPostBody } from '../../client/generated/v4/virtual-accounts.zod.js';

export const CreateVirtualAccountSchema = {
  customer_id: z.string().min(1).describe('ID of the customer (cus_…).'),
  reference: VirtualAccountsPostBody.shape.reference.optional().describe(
    `Unique reference for this create. ${RETRY_GUIDANCE}`,
  ),
  currency: VirtualAccountsPostBody.shape.currency,
  account_type: VirtualAccountsPostBody.shape.account_type,
  amount: VirtualAccountsPostBody.shape.amount,
  expiry: VirtualAccountsPostBody.shape.expiry,
  narration: VirtualAccountsPostBody.shape.narration,
  bvn: VirtualAccountsPostBody.shape.bvn,
  nin: VirtualAccountsPostBody.shape.nin,
  customer_account_number: VirtualAccountsPostBody.shape.customer_account_number,
  bank_code: VirtualAccountsPostBody.shape.bank_code,
  meta: VirtualAccountsPostBody.shape.meta,
  merchant_vat_amount: VirtualAccountsPostBody.shape.merchant_vat_amount,
};

export type CreateVirtualAccountArgs = {
  customer_id: string;
  reference?: string;
  currency: 'NGN' | 'GHS' | 'EGP' | 'KES' | 'MAD' | 'ZAR';
  account_type: 'static' | 'dynamic';
  amount?: number;
  expiry?: number;
  narration?: string;
  bvn?: string;
  nin?: string;
  customer_account_number?: string;
  bank_code?: string;
  meta?: Record<string, string>;
  merchant_vat_amount?: number;
};

export async function createVirtualAccount(args: CreateVirtualAccountArgs) {
  args = { ...args, reference: args.reference ?? newReference() };
  const strict = z.object(CreateVirtualAccountSchema).safeParse(args);
  if (!strict.success) {
    throw new Error(
      `Virtual account failed tool schema validation: ${strict.error.message}`,
    );
  }

  const body = VirtualAccountsPostBody.safeParse(args);
  if (!body.success) {
    throw new Error(
      `Virtual account body failed generated schema validation: ${body.error.message}`,
    );
  }

  return safeCreate({
    path: '/virtual-accounts',
    body: body.data,
    label: 'create virtual account',
    reference: (body.data as { reference?: string }).reference,
    lookup: lookupVirtualAccount,
    lookupHint: 'Check with list_virtual_accounts (filter reference).',
  });
}
