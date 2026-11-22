import Flutterwave from "../client/index.js";
import { server } from "../server.js";
import {
    ResolveBankAccountSchema,
    VerifyCardBinSchema,
} from "../types/verification/schema.js";
import {
    createBankAccountUI,
    createCardBinUI,
} from "../ui/index.js";

const verifyClient = Flutterwave.verification();

function createErrorResponse(message: string) {
    return { content: [{ type: "text" as const, text: message }] };
}

export async function resolveBankAccount(account_number: string, account_bank: string) {
    try {
        const response = await verifyClient.resolveBankAccount({ account_number, account_bank });
        if (!response) return createErrorResponse(`Could not resolve account ${account_number} at bank ${account_bank}.`);

        const d    = (response as any)?.data;
        const name = d?.account_name ?? 'Unknown';
        const num  = d?.account_number ?? account_number;

        const ui = createBankAccountUI({
            account_number: num,
            account_name:   name,
            bank_code:      account_bank,
        });

        return {
            content: [
                {
                    type: "text" as const,
                    text: `Account verified: ${name} · ${num} · Bank code: ${account_bank}`,
                },
                { type: "resource" as const, resource: ui },
            ],
        };
    } catch (error) {
        return createErrorResponse(`Error resolving account ${account_number}: ${JSON.stringify(error)}`);
    }
}

export async function verifyCardBin(bin: string) {
    try {
        const response = await verifyClient.verifyCardBin(bin);
        if (!response) return createErrorResponse(`No information found for card BIN: ${bin}`);

        const d = (response as any)?.data;

        const ui = createCardBinUI({
            bin:          d?.bin ?? bin,
            brand:        d?.brand,
            type:         d?.['card-type'],
            issuer:       d?.['issuer-info'],
            country:      d?.['iso-country-alpha2'],
            country_code: d?.['issuing-country'],
        });

        return {
            content: [
                {
                    type: "text" as const,
                    text: [
                        `Card BIN ${bin}: ${d?.brand ?? 'Unknown brand'} · ${d?.['card-type'] ?? 'Unknown type'}`,
                        `Issuer: ${d?.['issuer-info'] ?? 'N/A'} · Country: ${d?.['iso-country-alpha2'] ?? 'N/A'}`,
                    ].join('\n'),
                },
                { type: "resource" as const, resource: ui },
            ],
        };
    } catch (error) {
        return createErrorResponse(`Error verifying card BIN ${bin}: ${JSON.stringify(error)}`);
    }
}

export function registerVerificationTools() {
    server.tool(
        "resolve_bank_account",
        [
            "Verify a bank account number and look up the account holder name.",
            "Use this before initiating a transfer to confirm the recipient's details.",
            "Requires account_number (10 digits) and account_bank (3-digit bank code).",
            "Common bank codes: 044 = Access Bank, 057 = Zenith Bank, 033 = United Bank for Africa, 058 = GTBank, 011 = First Bank.",
            "Returns the account name — always show this to the user before proceeding with a transfer.",
        ].join(' '),
        ResolveBankAccountSchema,
        async (args) => {
            try {
                return await resolveBankAccount(args.account_number, args.account_bank);
            } catch (error) {
                return createErrorResponse(`Error resolving account ${args.account_number}`);
            }
        }
    );

    server.tool(
        "verify_card_bin",
        [
            "Look up card metadata using the first 6–8 digits (BIN) of a card number.",
            "Returns the card brand (Visa, Mastercard, Verve, AMEX), type (debit/credit/prepaid), issuing bank, and country of issue.",
            "Use this to validate cards before charging or to display card info to the user.",
            "Card numbers cannot be entered through this server: take card payments on hosted checkout.",
        ].join(' '),
        VerifyCardBinSchema,
        async (args) => {
            try {
                return await verifyCardBin(args.bin);
            } catch (error) {
                return createErrorResponse(`Error verifying card BIN ${args.bin}`);
            }
        }
    );
}
