import { z } from 'zod';
import { flwV4Fetch } from '../../client/v4/http.js';
import {
  ChargesPutBody,
  ChargesPutParams,
} from '../../client/generated/v4/charges-update.zod.js';
import { v4JsonResult } from './httpResult.js';

/**
 * The generated union has four authorization types: otp, pin, external_3ds, avs.
 * PIN authorization is removed from this server (Security review of DX-RFC-001,
 * decided 2026-11-22): a card PIN must never pass through the AI model, so the
 * tool offers only otp, external_3ds and avs.
 */
const [otpAuth, pinAuth, external3dsAuth, avsAuth] = ChargesPutBody.shape.authorization.unwrap().options;
export const ALLOWED_AUTHORIZATION_TYPES = ['otp', 'external_3ds', 'avs'] as const;
const typeOf = (option: { shape: { type: unknown } }) =>
  (option.shape.type as { unwrap(): { options: string[] } }).unwrap().options[0];
// If the generated union is regenerated in another order, fail at start-up rather than let PIN through.
if (
  typeOf(otpAuth) !== 'otp' || typeOf(pinAuth) !== 'pin' ||
  typeOf(external3dsAuth) !== 'external_3ds' || typeOf(avsAuth) !== 'avs'
) {
  throw new Error('update_charge: the generated authorization union changed; review the PIN exclusion.');
}
const UpdateChargeAuthorization = z.union([otpAuth, external3dsAuth, avsAuth]);

export const UpdateChargeSchema = {
  id: z.string().min(1).describe('ID of the charge to update (chg_…).'),
  meta: ChargesPutBody.shape.meta,
  authorization: UpdateChargeAuthorization
    .optional()
    .describe('otp, external_3ds or avs. PIN authorization is not available: card PINs must not pass through the AI model.'),
};

export type UpdateChargeArgs = {
  id: string;
  meta?: z.infer<typeof ChargesPutBody>['meta'];
  authorization?: z.infer<typeof UpdateChargeAuthorization>;
};

export async function updateCharge(args: UpdateChargeArgs) {
  const strict = z.object(UpdateChargeSchema).safeParse(args);
  if (!strict.success) {
    throw new Error(
      `Charge update failed tool schema validation: ${strict.error.message}`,
    );
  }

  const { id, ...bodyInput } = strict.data;
  if (bodyInput.meta === undefined && bodyInput.authorization === undefined) {
    throw new Error(
      'Charge update failed tool schema validation: provide meta or authorization',
    );
  }

  const idParsed = ChargesPutParams.safeParse({ id });
  if (!idParsed.success) {
    throw new Error(
      `Charge id failed generated schema validation: ${idParsed.error.message}`,
    );
  }

  const body = ChargesPutBody.safeParse(bodyInput);
  if (!body.success) {
    throw new Error(
      `Charge update body failed generated schema validation: ${body.error.message}`,
    );
  }

  const response = await flwV4Fetch(
    `/charges/${encodeURIComponent(idParsed.data.id)}`,
    { method: 'PUT', body: JSON.stringify(body.data) },
  );
  return v4JsonResult(response, 'update charge');
}
