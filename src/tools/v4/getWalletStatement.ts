import { z } from 'zod';
import { flwV4Fetch } from '../../client/v4/http.js';
import { GetWalletStatementQueryParams } from '../../client/generated/v4/wallet-statement.zod.js';
import { toQueryString, v4JsonResult } from './httpResult.js';
import { dateOnly } from './dateParams.js';

export const GetWalletStatementSchema = {
  currency: GetWalletStatementQueryParams.shape.currency.describe(
    'Wallet currency, for example NGN. Required: the API rejects a statement request without it.',
  ),
  from: dateOnly('Start').optional(),
  to: dateOnly('End').optional(),
  size: z
    .number()
    .int()
    .min(10)
    .max(50)
    .optional()
    .describe('Page size. Flutterwave requires 10 to 50. Defaults to 10.'),
  next: z.string().min(1).optional().describe('Cursor for the next page.'),
  previous: z
    .string()
    .min(1)
    .optional()
    .describe('Cursor for the previous page.'),
};

export type GetWalletStatementArgs = {
  currency: z.infer<typeof GetWalletStatementQueryParams>['currency'];
  from?: string;
  to?: string;
  size?: number;
  next?: string;
  previous?: string;
};

export async function getWalletStatement(args: GetWalletStatementArgs) {
  const parsed = GetWalletStatementQueryParams.safeParse(args);
  if (!parsed.success) {
    throw new Error(
      `Wallet statement query failed generated schema validation: ${parsed.error.message}`,
    );
  }

  const response = await flwV4Fetch(
    `/wallets/statement${toQueryString(parsed.data)}`,
    { method: 'GET' },
  );
  if (response.status === 404) {
    // The API answers "no matching entries" with 404 TRANSFER_NOT_FOUND (301404),
    // not an empty list (sandbox, 12 Nov 2026). Report it as no results.
    const raw = await response.text();
    if (/TRANSFER_NOT_FOUND|301404/.test(raw)) {
      return v4JsonResult(
        new Response(
          JSON.stringify({
            status: 'success',
            message: 'No statement entries for this currency and date range.',
            data: [],
            note: 'Flutterwave returned 404 TRANSFER_NOT_FOUND, which means no entries.',
          }),
          { status: 200 },
        ),
        'get wallet statement',
      );
    }
    return v4JsonResult(new Response(raw, { status: 404 }), 'get wallet statement');
  }
  return v4JsonResult(response, 'get wallet statement');
}
