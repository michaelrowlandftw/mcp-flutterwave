import { describe, it, expect } from 'vitest';
import {
    ResolveBankAccountSchema,
    VerifyCardBinSchema,
} from '../types/verification/schema.js';
import {
    createBankAccountUI,
    createCardBinUI,
} from '../ui/index.js';

// ─── Schema tests ─────────────────────────────────────────────────────────────

describe('ResolveBankAccountSchema', () => {
    it('accepts valid 10-digit account number', () => {
        expect(ResolveBankAccountSchema.account_number.safeParse('0690000040').success).toBe(true);
        expect(ResolveBankAccountSchema.account_number.safeParse('2012345678').success).toBe(true);
    });

    it('rejects account number not exactly 10 digits', () => {
        expect(ResolveBankAccountSchema.account_number.safeParse('123456789').success).toBe(false);
        expect(ResolveBankAccountSchema.account_number.safeParse('12345678901').success).toBe(false);
    });

    it('rejects account number with non-digit characters', () => {
        expect(ResolveBankAccountSchema.account_number.safeParse('069000004A').success).toBe(false);
    });

    it('accepts valid bank code', () => {
        expect(ResolveBankAccountSchema.account_bank.safeParse('044').success).toBe(true);
        expect(ResolveBankAccountSchema.account_bank.safeParse('057').success).toBe(true);
    });

    it('rejects empty bank code', () => {
        expect(ResolveBankAccountSchema.account_bank.safeParse('').success).toBe(false);
    });
});

describe('VerifyCardBinSchema', () => {
    it('accepts 6-digit BIN', () => {
        expect(VerifyCardBinSchema.bin.safeParse('553188').success).toBe(true);
        expect(VerifyCardBinSchema.bin.safeParse('404042').success).toBe(true);
        expect(VerifyCardBinSchema.bin.safeParse('340614').success).toBe(true);
    });

    it('accepts 7-digit and 8-digit BIN', () => {
        expect(VerifyCardBinSchema.bin.safeParse('5531886').success).toBe(true);
        expect(VerifyCardBinSchema.bin.safeParse('55318866').success).toBe(true);
    });

    it('rejects BIN shorter than 6 digits', () => {
        expect(VerifyCardBinSchema.bin.safeParse('55318').success).toBe(false);
        expect(VerifyCardBinSchema.bin.safeParse('123').success).toBe(false);
    });

    it('rejects BIN longer than 8 digits', () => {
        expect(VerifyCardBinSchema.bin.safeParse('553188665').success).toBe(false);
    });

    it('rejects BIN with non-digit characters', () => {
        expect(VerifyCardBinSchema.bin.safeParse('55318X').success).toBe(false);
        expect(VerifyCardBinSchema.bin.safeParse('553-18').success).toBe(false);
    });
});

// ─── UI tests ─────────────────────────────────────────────────────────────────

describe('createBankAccountUI', () => {
    const baseAccount = {
        account_number: '0690000040',
        account_name: 'Desola Ade',
        bank_code: '044',
    };

    it('returns a UI resource with correct uri', () => {
        const resource = createBankAccountUI(baseAccount);
        expect(resource).toBeDefined();
        expect(resource.uri).toContain('ui://bank-account/');
        expect(resource.uri).toContain('0690000040');
    });

    it('includes account name prominently', () => {
        const str = JSON.stringify(createBankAccountUI(baseAccount));
        expect(str).toContain('Desola Ade');
    });

    it('includes account number and bank code', () => {
        const str = JSON.stringify(createBankAccountUI(baseAccount));
        expect(str).toContain('0690000040');
        expect(str).toContain('044');
    });
});

describe('createCardBinUI', () => {
    const baseBin = {
        bin: '553188',
        brand: 'MASTERCARD',
        type: 'CREDIT',
        issuer: 'NEXUS MERCHANT BANK',
        country: 'NIGERIA',
        country_code: 'NG',
    };

    it('returns a UI resource with correct uri', () => {
        const resource = createCardBinUI(baseBin);
        expect(resource).toBeDefined();
        expect(resource.uri).toContain('ui://card-bin/');
        expect(resource.uri).toContain('553188');
    });

    it('includes brand and card type', () => {
        const str = JSON.stringify(createCardBinUI(baseBin));
        expect(str).toContain('MASTERCARD');
        expect(str).toContain('CREDIT');
    });

    it('includes issuer and country', () => {
        const str = JSON.stringify(createCardBinUI(baseBin));
        expect(str).toContain('NEXUS MERCHANT BANK');
        expect(str).toContain('NIGERIA');
    });

    it('handles VISA card', () => {
        const str = JSON.stringify(createCardBinUI({ bin: '404042', brand: 'VISA', type: 'DEBIT' }));
        expect(str).toContain('VISA');
        expect(str).toContain('DEBIT');
    });

    it('handles AMEX card', () => {
        const str = JSON.stringify(createCardBinUI({ bin: '340614', brand: 'AMERICAN EXPRESS', type: 'CREDIT' }));
        expect(str).toContain('AMERICAN EXPRESS');
    });

    it('handles minimal data (unknown brand)', () => {
        const resource = createCardBinUI({ bin: '123456' });
        expect(resource).toBeDefined();
    });
});
