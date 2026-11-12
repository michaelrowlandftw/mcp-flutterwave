import { z } from 'zod';

export const CreateTransferPayloadSchema = {
    account_bank: z.string().min(1, "Account bank is required"),
    account_number: z.string().min(1, "Account number is required"),
    amount: z.number().positive("Amount must be a positive number"),
    currency: z.string().min(1, "Currency is required"),
    callback_url: z.string().url().optional(),
    reference: z.string().min(1).optional().describe("Leave empty to let the server create a unique reference; keep the one it returns. If the result is \"unknown\", look the payment up by this reference before any retry."),
    narration: z.string().optional(),
    beneficiary_name: z.string().optional(),
};

export const GetTransfersFiltersSchema = {
    id: z.string().min(1).optional(),
};

export const CreateBeneficiaryPayloadSchema = {
    account_bank: z.string().min(1, "Account bank is required"),
    account_number: z.string().min(1, "Account number is required"),
    beneficiary_name: z.string().min(1, "Beneficiary name is required"),
    currency: z.string().min(1, "Currency is required"),
    bank_name: z.string().min(1, "Bank name is required"),
};