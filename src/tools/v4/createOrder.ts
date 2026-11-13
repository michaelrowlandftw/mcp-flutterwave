import { z } from 'zod';
import { newReference, RETRY_GUIDANCE } from '../../utils/reference.js';
import { safeCreate, lookupOrder } from './safeCreate.js';
import { OrdersPostBody } from '../../client/generated/v4/orders.zod.js';

export const CreateOrderSchema = {
  amount: OrdersPostBody.shape.amount,
  currency: OrdersPostBody.shape.currency,
  reference: OrdersPostBody.shape.reference.optional().describe(
    `Unique reference for this create. ${RETRY_GUIDANCE}`,
  ),
  customer_id: z.string().min(1).describe('ID of the customer (cus_…).'),
  payment_method_id: z
    .string()
    .min(1)
    .describe('ID of the payment method (pmd_…).'),
  redirect_url: OrdersPostBody.shape.redirect_url,
  meta: OrdersPostBody.shape.meta,
  merchant_vat_amount: OrdersPostBody.shape.merchant_vat_amount,
};

export type CreateOrderArgs = {
  amount: number;
  currency: string;
  reference?: string;
  customer_id: string;
  payment_method_id: string;
  redirect_url?: string;
  meta?: Record<string, string>;
  merchant_vat_amount?: number;
};

export async function createOrder(args: CreateOrderArgs) {
  args = { ...args, reference: args.reference ?? newReference() };
  const strict = z.object(CreateOrderSchema).safeParse(args);
  if (!strict.success) {
    throw new Error(
      `Order failed tool schema validation: ${strict.error.message}`,
    );
  }

  const body = OrdersPostBody.safeParse(args);
  if (!body.success) {
    throw new Error(
      `Order body failed generated schema validation: ${body.error.message}`,
    );
  }

  return safeCreate({
    path: '/orders',
    body: body.data,
    label: 'create order',
    reference: (body.data as { reference?: string }).reference,
    lookup: lookupOrder,
    lookupHint: 'Check with list_orders or get_order.',
  });
}
