import { describe, it, expect } from 'vitest';
import { CheckoutPayloadSchema, DisableCheckoutSchema } from '../types/checkout/schema.js';
import { CreateTransferPayloadSchema, CreateBeneficiaryPayloadSchema } from '../types/transfer/schema.js';
import { CreatePlanPayloadSchema, GetPlansFiltersSchema } from '../types/plan/schema.js';
import {
    ChargeBankAccountSchema,
    ChargeMobileMoneySchema,
    ChargeMpesaSchema,
    ChargeUssdSchema,
    ValidateChargeSchema,
} from '../types/charge/schema.js';

describe('CheckoutPayloadSchema', () => {
    it('accepts valid tx_ref', () => {
        expect(CheckoutPayloadSchema.tx_ref.safeParse('TXN-001').success).toBe(true);
    });
    it('rejects empty tx_ref', () => {
        expect(CheckoutPayloadSchema.tx_ref.safeParse('').success).toBe(false);
    });
    it('accepts valid redirect_url', () => {
        expect(CheckoutPayloadSchema.redirect_url.safeParse('https://example.com').success).toBe(true);
    });
    it('rejects invalid redirect_url', () => {
        expect(CheckoutPayloadSchema.redirect_url.safeParse('not-a-url').success).toBe(false);
    });
    it('accepts valid customer email', () => {
        expect(CheckoutPayloadSchema.customer.safeParse({ email: 'test@example.com', name: 'John', phonenumber: '0801' }).success).toBe(true);
    });
    it('rejects invalid customer email', () => {
        expect(CheckoutPayloadSchema.customer.safeParse({ email: 'not-email', name: 'John', phonenumber: '0801' }).success).toBe(false);
    });
});

describe('DisableCheckoutSchema', () => {
    it('accepts valid URL', () => {
        expect(DisableCheckoutSchema.link.safeParse('https://pay.flutterwave.com/link/abc').success).toBe(true);
    });
    it('rejects non-URL', () => {
        expect(DisableCheckoutSchema.link.safeParse('abc').success).toBe(false);
    });
});

describe('CreateTransferPayloadSchema', () => {
    it('accepts valid amount', () => {
        expect(CreateTransferPayloadSchema.amount.safeParse(5000).success).toBe(true);
    });
    it('rejects zero amount', () => {
        expect(CreateTransferPayloadSchema.amount.safeParse(0).success).toBe(false);
    });
    it('accepts optional callback_url when valid', () => {
        expect(CreateTransferPayloadSchema.callback_url.safeParse('https://example.com').success).toBe(true);
    });
    it('accepts undefined callback_url', () => {
        expect(CreateTransferPayloadSchema.callback_url.safeParse(undefined).success).toBe(true);
    });
});

describe('CreateBeneficiaryPayloadSchema', () => {
    it('rejects empty beneficiary_name', () => {
        expect(CreateBeneficiaryPayloadSchema.beneficiary_name.safeParse('').success).toBe(false);
    });
    it('accepts valid beneficiary_name', () => {
        expect(CreateBeneficiaryPayloadSchema.beneficiary_name.safeParse('Jane Doe').success).toBe(true);
    });
});

describe('CreatePlanPayloadSchema', () => {
    it('accepts valid interval', () => {
        expect(CreatePlanPayloadSchema.interval.safeParse('monthly').success).toBe(true);
    });
    it('rejects invalid interval', () => {
        expect(CreatePlanPayloadSchema.interval.safeParse('hourly').success).toBe(false);
    });
    it('accepts positive amount', () => {
        expect(CreatePlanPayloadSchema.amount.safeParse(1000).success).toBe(true);
    });
    it('rejects negative amount', () => {
        expect(CreatePlanPayloadSchema.amount.safeParse(-100).success).toBe(false);
    });
});

describe('GetPlansFiltersSchema', () => {
    it('accepts valid status', () => {
        expect(GetPlansFiltersSchema.status.safeParse('active').success).toBe(true);
    });
    it('rejects unknown status', () => {
        expect(GetPlansFiltersSchema.status.safeParse('deleted').success).toBe(false);
    });
    it('accepts undefined status', () => {
        expect(GetPlansFiltersSchema.status.safeParse(undefined).success).toBe(true);
    });
});

describe('ChargeBankAccountSchema', () => {
    it('accepts valid account_bank', () => {
        expect(ChargeBankAccountSchema.account_bank.safeParse('044').success).toBe(true);
    });
    it('rejects empty account_bank', () => {
        expect(ChargeBankAccountSchema.account_bank.safeParse('').success).toBe(false);
    });
    it('accepts valid account_number', () => {
        expect(ChargeBankAccountSchema.account_number.safeParse('0690000031').success).toBe(true);
    });
    it('rejects empty account_number', () => {
        expect(ChargeBankAccountSchema.account_number.safeParse('').success).toBe(false);
    });
});

describe('ChargeMobileMoneySchema', () => {
    it('accepts valid mobile money type', () => {
        expect(ChargeMobileMoneySchema.type.safeParse('mobile_money_ghana').success).toBe(true);
    });
    it('rejects invalid mobile money type', () => {
        expect(ChargeMobileMoneySchema.type.safeParse('mpesa').success).toBe(false);
    });
    it('accepts all valid mobile money types', () => {
        const types = ['mobile_money_ghana', 'mobile_money_uganda', 'mobile_money_rwanda', 'mobile_money_zambia', 'mobile_money_francophone'];
        types.forEach(t => expect(ChargeMobileMoneySchema.type.safeParse(t).success).toBe(true));
    });
    it('requires phone_number', () => {
        expect(ChargeMobileMoneySchema.phone_number.safeParse('').success).toBe(false);
        expect(ChargeMobileMoneySchema.phone_number.safeParse('0551234987').success).toBe(true);
    });
});

describe('ChargeMpesaSchema', () => {
    it('only accepts KES currency', () => {
        expect(ChargeMpesaSchema.currency.safeParse('KES').success).toBe(true);
    });
    it('rejects non-KES currency', () => {
        expect(ChargeMpesaSchema.currency.safeParse('NGN').success).toBe(false);
    });
    it('requires phone_number', () => {
        expect(ChargeMpesaSchema.phone_number.safeParse('').success).toBe(false);
        expect(ChargeMpesaSchema.phone_number.safeParse('0712345678').success).toBe(true);
    });
});

describe('ChargeUssdSchema', () => {
    it('only accepts NGN currency', () => {
        expect(ChargeUssdSchema.currency.safeParse('NGN').success).toBe(true);
    });
    it('rejects non-NGN currency', () => {
        expect(ChargeUssdSchema.currency.safeParse('GHS').success).toBe(false);
    });
    it('requires account_bank', () => {
        expect(ChargeUssdSchema.account_bank.safeParse('').success).toBe(false);
        expect(ChargeUssdSchema.account_bank.safeParse('044').success).toBe(true);
    });
    it('requires phone_number', () => {
        expect(ChargeUssdSchema.phone_number.safeParse('').success).toBe(false);
        expect(ChargeUssdSchema.phone_number.safeParse('09000000000').success).toBe(true);
    });
});

describe('ValidateChargeSchema', () => {
    it('accepts valid OTP', () => {
        expect(ValidateChargeSchema.otp.safeParse('12345').success).toBe(true);
    });
    it('rejects OTP shorter than 4 characters', () => {
        expect(ValidateChargeSchema.otp.safeParse('123').success).toBe(false);
    });
    it('accepts valid flw_ref', () => {
        expect(ValidateChargeSchema.flw_ref.safeParse('FLW-MOCK-abc123').success).toBe(true);
    });
    it('rejects empty flw_ref', () => {
        expect(ValidateChargeSchema.flw_ref.safeParse('').success).toBe(false);
    });
    it('accepts undefined type', () => {
        expect(ValidateChargeSchema.type.safeParse(undefined).success).toBe(true);
    });
});
