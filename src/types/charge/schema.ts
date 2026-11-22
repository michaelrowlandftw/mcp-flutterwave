import { z } from 'zod';

const MOBILE_MONEY_TYPES = [
    'mobile_money_ghana',
    'mobile_money_uganda',
    'mobile_money_rwanda',
    'mobile_money_zambia',
    'mobile_money_francophone',
] as const;

export const ChargeTokenizedCardSchema = {
    token: z.string().min(1, 'Card token is required').describe("The card token from an earlier successful 3DS checkout payment (data.card.token on the verified transaction). Never a card number."),
    tx_ref: z.string().min(1).optional().describe("Leave empty to let the server create a unique reference; keep the one it returns. If the result is \"unknown\", look the payment up by this reference before any retry."),
    amount: z.number().positive('Amount must be greater than 0'),
    currency: z.string().regex(/^[A-Z]{3}$/, 'Currency must be an ISO 4217 code, for example NGN'),
    email: z.string().email('Invalid email address').describe('The email the card was saved with.'),
    country: z.string().regex(/^[A-Z]{2}$/, 'Country must be an ISO 3166 alpha-2 code').optional(),
    narration: z.string().max(100).optional(),
    redirect_url: z.string().url('Redirect URL must be a valid URL').optional().describe('Where the customer returns after 3D Secure. https only.'),
};

export const ChargeBankAccountSchema = {
    tx_ref: z.string().min(1).optional().describe("Leave empty to let the server create a unique reference; keep the one it returns. If the result is \"unknown\", look the payment up by this reference before any retry."),
    amount: z.string().min(1, 'Amount is required'),
    currency: z.string().min(1, 'Currency is required'),
    email: z.string().email('Invalid email address'),
    account_bank: z.string().min(1, 'Account bank code is required'),
    account_number: z.string().min(1, 'Account number is required'),
    fullname: z.string().optional(),
    phone_number: z.string().optional()
};

export const ChargeMobileMoneySchema = {
    type: z.enum(MOBILE_MONEY_TYPES, {
        error: `Type must be one of: ${MOBILE_MONEY_TYPES.join(', ')}`,
    }),
    tx_ref: z.string().min(1).optional().describe("Leave empty to let the server create a unique reference; keep the one it returns. If the result is \"unknown\", look the payment up by this reference before any retry."),
    amount: z.string().min(1, 'Amount is required'),
    currency: z.string().min(1, 'Currency is required'),
    email: z.string().email('Invalid email address'),
    phone_number: z.string().min(1, 'Phone number is required for mobile money'),
    network: z.string().min(1, 'Network is required (e.g. MTN, VODAFONE, TIGO)').optional(),
    fullname: z.string().optional(),
};

export const ChargeMpesaSchema = {
    tx_ref: z.string().min(1).optional().describe("Leave empty to let the server create a unique reference; keep the one it returns. If the result is \"unknown\", look the payment up by this reference before any retry."),
    amount: z.string().min(1, 'Amount is required'),
    currency: z.literal('KES', { error: 'Currency must be KES for M-Pesa' }),
    email: z.string().email('Invalid email address'),
    phone_number: z.string().min(1, 'Phone number is required for M-Pesa'),
    fullname: z.string().optional(),
};

export const ChargeUssdSchema = {
    tx_ref: z.string().min(1).optional().describe("Leave empty to let the server create a unique reference; keep the one it returns. If the result is \"unknown\", look the payment up by this reference before any retry."),
    amount: z.string().min(1, 'Amount is required'),
    currency: z.literal('NGN', { error: 'Currency must be NGN for USSD' }),
    email: z.string().email('Invalid email address'),
    account_bank: z.string().min(1, 'Account bank code is required for USSD'),
    phone_number: z.string().min(1, 'Phone number is required for USSD'),
    fullname: z.string().optional(),
};

export const ValidateChargeSchema = {
    otp: z.string().min(4, 'OTP must be at least 4 characters'),
    flw_ref: z.string().min(1, 'Flutterwave reference is required'),
    type: z.string().optional(),
};
