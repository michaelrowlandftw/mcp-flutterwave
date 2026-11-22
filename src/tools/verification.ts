import Flutterwave from "../client/index.js";
import { server } from "../server.js";
import {
    InitiateBvnSchema,
    GetBvnDetailsSchema,
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

/**
 * BVN tools, restricted under the Security review of DX-RFC-001 (2026-11-17;
 * Michael kept them for a support use case on 2026-11-22):
 * - initiate_bvn_verification takes a full BVN, so it asks the person to confirm
 *   first (the same confirmation as money-moving tools) and returns no UI card.
 * - get_bvn_details never returns identity data, in text or a UI card. It compares
 *   the names (and optionally the date of birth) the caller expects with the record
 *   and answers match / no-match per field.
 */
export async function initiateBvnVerification(payload: {
    bvn: string;
    firstname: string;
    lastname: string;
    redirect_url: string;
}) {
    try {
        const response = await verifyClient.initiateBvnVerification(payload as any);
        if (!response) return createErrorResponse('Failed to initiate BVN verification.');

        const d         = (response as any)?.data;
        const reference = d?.reference ?? '';
        const url       = d?.url ?? null;

        const consentNote = url
            ? `Consent URL (single-use): ${url}\nShare it with the customer. After they consent, call get_bvn_details with reference "${reference}" and the names you expect.`
            : `The customer has already consented. Call get_bvn_details with reference "${reference}" and the names you expect.`;

        return {
            content: [
                {
                    type: "text" as const,
                    text: [`BVN verification initiated (BVN ending ${payload.bvn.slice(-4)}).`, `Reference: ${reference}`, consentNote].join('\n'),
                },
            ],
        };
    } catch (error) {
        return createErrorResponse('Error initiating BVN verification.');
    }
}

const norm = (value: unknown) =>
    typeof value === 'string' ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ') : undefined;

/** The record's date of birth as YYYY-MM-DD, when it can be read without guessing. The format is not documented. */
function isoDate(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const months: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const named = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim());
    if (named && months[named[2].toLowerCase()]) return `${named[3]}-${months[named[2].toLowerCase()]}-${named[1].padStart(2, '0')}`;
    return undefined;
}

type FieldMatch = 'match' | 'no_match' | 'not_available';

function compare(expected: string | undefined, actual: string | undefined): FieldMatch {
    if (actual === undefined) return 'not_available';
    return norm(expected) === norm(actual) ? 'match' : 'no_match';
}

export async function getBvnDetails(args: {
    reference: string;
    expected_first_name: string;
    expected_last_name: string;
    expected_date_of_birth?: string;
}) {
    const reference = args.reference;
    try {
        const response = await verifyClient.getBvnDetails(reference);
        if (!response) return createErrorResponse(`BVN verification not found: ${reference}`);

        const d    = (response as any)?.data;
        const bvnd = d?.bvn_data;
        const status = typeof d?.status === 'string' ? d.status : 'PENDING';

        if (status !== 'COMPLETED' || !bvnd) {
            return {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify({ reference, status, match: null, note: 'The customer has not completed consent yet. Poll again later.' }, null, 2),
                }],
            };
        }

        const fields: Record<string, FieldMatch> = {
            first_name: compare(args.expected_first_name, bvnd.firstName ?? d?.first_name),
            last_name: compare(args.expected_last_name, bvnd.surname ?? bvnd.lastName ?? d?.last_name),
        };
        if (args.expected_date_of_birth !== undefined) {
            const actual = isoDate(bvnd.dateOfBirth);
            fields.date_of_birth = actual === undefined ? 'not_available' : (actual === args.expected_date_of_birth ? 'match' : 'no_match');
        }
        const values = Object.values(fields);
        const match = values.every((v) => v === 'match') ? true : values.some((v) => v === 'no_match') ? false : null;

        // Only the comparison leaves the server: no names, dates, numbers, images or watchlist data.
        return {
            content: [{
                type: "text" as const,
                text: JSON.stringify({ reference, status, match, fields }, null, 2),
            }],
        };
    } catch (error) {
        return createErrorResponse(`Error checking BVN verification ${reference}.`);
    }
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
        "initiate_bvn_verification",
        [
            "Start a BVN (Bank Verification Number) consent request for a Nigerian customer.",
            "Takes the full BVN, so the server asks the person to confirm before anything is sent.",
            "Returns a single-use consent URL for the customer, or none if they already consented, and a reference for get_bvn_details.",
            "Needs BVN verification enabled on the Flutterwave account.",
        ].join(' '),
        InitiateBvnSchema,
        async (args) => {
            try {
                return await initiateBvnVerification(args as any);
            } catch (error) {
                return createErrorResponse('Error initiating BVN verification.');
            }
        }
    );

    server.tool(
        "get_bvn_details",
        [
            "Check a completed BVN verification against the names you expect (and optionally the date of birth).",
            "Returns match / no-match per field only. It never returns identity data: no names, date of birth, phone, NIN, photo or watchlist status.",
            "match is null while the customer has not consented or a field is not on the record.",
        ].join(' '),
        GetBvnDetailsSchema,
        async (args) => {
            try {
                return await getBvnDetails(args);
            } catch (error) {
                return createErrorResponse(`Error checking BVN verification ${args.reference}.`);
            }
        }
    );

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
