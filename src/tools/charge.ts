import Flutterwave from "../client/index.js";
import { uncertainV3, withReference } from '../utils/reference.js';
import { lookupV3Transaction, sendV3Safely } from './safeCreateV3.js';
import { server } from "../server.js";
import {
    ChargeTokenizedCardSchema,
    ChargeBankAccountSchema,
    ChargeMobileMoneySchema,
    ChargeMpesaSchema,
    ChargeUssdSchema,
    ValidateChargeSchema,
} from "../types/charge/schema.js";
import {
    createChargeUI,
    create3dsRedirectUI,
    createOtpPromptUI,
} from "../ui/index.js";

const chargeClient = Flutterwave.charges();

function createErrorResponse(message: string) {
    return { content: [{ type: "text" as const, text: message }] };
}

/**
 * V3 puts the redirect URL in a different field per rail (flw-api-monitor report
 * sections 9 and 14): meta.authorization.redirect, data.meta.authorization.redirect
 * or meta.authorization.redirect_url. Read all three.
 */
export function redirectUrlOf(response: any): string {
    const candidates = [
        response?.meta?.authorization?.redirect,
        response?.data?.meta?.authorization?.redirect,
        response?.meta?.authorization?.redirect_url,
        response?.data?.meta?.authorization?.redirect_url,
    ];
    const found = candidates.find((value) => typeof value === 'string' && value !== '');
    return found ?? '';
}

function isValidResponse(status: unknown, data: unknown): boolean {
    return !(typeof status === 'number' && status >= 400) && !!data;
}

/**
 * Inspect a Flutterwave charge response (bank account, mobile money, M-Pesa,
 * USSD, tokenised card) and return the right UI + text:
 *
 *   redirect   – the customer must open a page (3DS, captcha, provider page)
 *   otp        – an OTP was sent; data present
 *   (none)     – charge completed (successful/failed) or pending
 *
 * Card PIN and AVS steps belong to Direct Charge, which this server does not
 * offer (Security review of DX-RFC-001, 2026-11-22).
 */
function buildChargeResponse(response: any, tx_ref: string, chargeType: string) {
    const meta       = response?.meta;
    const authMode   = meta?.authorization?.mode as string | undefined;
    const chargeData = response?.data;

    // ── Scenario 3: 3DS redirect (first or second call) ──────────────────────
    const redirectUrl = redirectUrlOf(response);
    if (authMode === 'redirect' || (redirectUrl && authMode !== 'otp')) {
        const ui = create3dsRedirectUI({
            tx_ref:       chargeData?.tx_ref ?? tx_ref,
            charge_type:  chargeType,
            redirect_url: redirectUrl,
            flw_ref:      chargeData?.flw_ref,
            amount:       Number(chargeData?.amount ?? 0),
            currency:     chargeData?.currency ?? 'NGN',
        });
        return {
            content: [
                {
                    type: "text" as const,
                    text: [
                        `The customer must complete this payment on the page below (3D Secure, captcha or the provider's page).`,
                        `Redirect the customer to: ${redirectUrl}`,
                        `Transaction ID: ${chargeData?.id ?? 'N/A'} — store this to verify later.`,
                        `After the customer completes bank authentication they will be sent to redirect_url.`,
                        `Call read_transaction with that transaction ID to confirm the outcome.`,
                    ].join('\n'),
                },
                { type: "resource" as const, resource: ui },
            ],
        };
    }

    // ── Scenario 4: OTP required (second call after PIN/AVS) ─────────────────
    if (authMode === 'otp') {
        const flw_ref            = chargeData?.flw_ref ?? '';
        const processor_response = chargeData?.processor_response;
        const ui = createOtpPromptUI({
            tx_ref:              chargeData?.tx_ref ?? tx_ref,
            charge_type:         chargeType,
            flw_ref,
            processor_response,
            amount:              Number(chargeData?.amount ?? 0),
            currency:            chargeData?.currency ?? 'NGN',
            email:               chargeData?.customer?.email,
        });
        return {
            content: [
                {
                    type: "text" as const,
                    text: [
                        processor_response ? `Bank message: ${processor_response}` : `OTP validation required.`,
                        `flw_ref: ${flw_ref}`,
                        `Ask the customer for the OTP, then call validate_charge with:`,
                        `{ otp: "<OTP>", flw_ref: "${flw_ref}" }`,
                    ].join('\n'),
                },
                { type: "resource" as const, resource: ui },
            ],
        };
    }

    // ── Scenario 5: Completed (no auth needed / final status) ────────────────
    const status = chargeData?.status ?? 'unknown';
    const ui = createChargeUI({
        tx_ref:              chargeData?.tx_ref ?? tx_ref,
        status,
        amount:              Number(chargeData?.amount ?? 0),
        currency:            chargeData?.currency ?? 'NGN',
        charge_type:         chargeType,
        email:               chargeData?.customer?.email ?? '',
        fullname:            chargeData?.customer?.name,
        flw_ref:             chargeData?.flw_ref,
        processor_response:  chargeData?.processor_response,
    });
    const idNote = chargeData?.id ? ` Transaction ID: ${chargeData.id}.` : '';
    return {
        content: [
            { type: "text" as const, text: `Charge ${status}.${idNote}` },
            { type: "resource" as const, resource: ui },
        ],
    };
}

// ─── Tool handlers ────────────────────────────────────────────────────────────

export async function chargeTokenizedCard(payload: {
    token: string; tx_ref: string; amount: number; currency: string; email: string;
    country?: string; narration?: string; redirect_url?: string;
}) {
    try {
        const sent = await sendV3Safely({
            action: 'charge saved card', reference: payload.tx_ref, lookupTool: 'read_transaction_with_reference',
            lookup: lookupV3Transaction, send: () => chargeClient.chargeTokenized({
            token:        payload.token,
            tx_ref:       payload.tx_ref,
            amount:       payload.amount,
            currency:     payload.currency,
            email:        payload.email,
            country:      payload.country,
            narration:    payload.narration,
            redirect_url: payload.redirect_url,
        }),
        });
        if ('result' in sent) return sent.result;
        const response = sent.response;

        if (!response || !isValidResponse(null, response)) {
            return uncertainV3('charge saved card', payload.tx_ref, 'read_transaction_with_reference');
        }

        return buildChargeResponse(response, payload.tx_ref, 'tokenized_card');
    } catch (error) {
        return uncertainV3('charging saved card', payload.tx_ref, 'read_transaction_with_reference', error instanceof Error ? error.message : 'request error');
    }
}

export async function chargeBankAccount(payload: {
    tx_ref: string; amount: string; currency: string; email: string;
    account_bank: string; account_number: string; fullname?: string; phone_number?: string;
}) {
    try {
        const sent = await sendV3Safely({
            action: 'charge bank account', reference: payload.tx_ref, lookupTool: 'read_transaction_with_reference',
            lookup: lookupV3Transaction, send: () => chargeClient.chargeBankAccount({
            tx_ref:         payload.tx_ref,
            amount:         payload.amount,
            currency:       payload.currency,
            email:          payload.email,
            account_bank:   payload.account_bank,
            account_number: payload.account_number,
            fullname:       payload.fullname,
            phone_number:   payload.phone_number,
        }),
        });
        if ('result' in sent) return sent.result;
        const response = sent.response;

        if (!response || !isValidResponse(null, response)) {
            return uncertainV3('charge bank account', payload.tx_ref, 'read_transaction_with_reference');
        }

        return buildChargeResponse(response, payload.tx_ref, 'account');
    } catch (error) {
        return uncertainV3('charging bank account', payload.tx_ref, 'read_transaction_with_reference', error instanceof Error ? error.message : 'request error');
    }
}

export async function chargeMobileMoney(payload: {
    type: 'mobile_money_ghana' | 'mobile_money_uganda' | 'mobile_money_rwanda' | 'mobile_money_zambia' | 'mobile_money_francophone';
    tx_ref: string; amount: string; currency: string; email: string;
    phone_number: string; network?: string; fullname?: string;
}) {
    try {
        const { type, ...rest } = payload;
        const sent = await sendV3Safely({
            action: 'charge mobile money', reference: rest.tx_ref, lookupTool: 'read_transaction_with_reference',
            lookup: lookupV3Transaction, send: () => chargeClient.chargeMobileMoney(type, {
            tx_ref:       rest.tx_ref,
            amount:       rest.amount,
            currency:     rest.currency,
            email:        rest.email,
            phone_number: rest.phone_number,
            network:      rest.network,
            fullname:     rest.fullname,
        }),
        });
        if ('result' in sent) return sent.result;
        const response = sent.response;

        if (!response || !isValidResponse(null, response)) {
            return uncertainV3('charge mobile money', payload.tx_ref, 'read_transaction_with_reference');
        }

        return buildChargeResponse(response, payload.tx_ref, type);
    } catch (error) {
        return uncertainV3('charging mobile money', payload.tx_ref, 'read_transaction_with_reference', error instanceof Error ? error.message : 'request error');
    }
}

export async function chargeMpesa(payload: {
    tx_ref: string; amount: string; currency: 'KES'; email: string;
    phone_number: string; fullname?: string;
}) {
    try {
        const sent = await sendV3Safely({
            action: 'charge M-Pesa', reference: payload.tx_ref, lookupTool: 'read_transaction_with_reference',
            lookup: lookupV3Transaction, send: () => chargeClient.chargeMpesa({
            tx_ref:       payload.tx_ref,
            amount:       payload.amount,
            currency:     payload.currency,
            email:        payload.email,
            phone_number: payload.phone_number,
            fullname:     payload.fullname,
        }),
        });
        if ('result' in sent) return sent.result;
        const response = sent.response;

        if (!response || !isValidResponse(null, response)) {
            return uncertainV3('charge M-Pesa', payload.tx_ref, 'read_transaction_with_reference');
        }

        return buildChargeResponse(response, payload.tx_ref, 'mpesa');
    } catch (error) {
        return uncertainV3('charging M-Pesa', payload.tx_ref, 'read_transaction_with_reference', error instanceof Error ? error.message : 'request error');
    }
}

export async function chargeUssd(payload: {
    tx_ref: string; amount: string; currency: 'NGN'; email: string;
    account_bank: string; phone_number: string; fullname?: string;
}) {
    try {
        const sent = await sendV3Safely({
            action: 'initiate USSD charge', reference: payload.tx_ref, lookupTool: 'read_transaction_with_reference',
            lookup: lookupV3Transaction, send: () => chargeClient.chargeUssd({
            tx_ref:       payload.tx_ref,
            amount:       payload.amount,
            currency:     payload.currency,
            email:        payload.email,
            account_bank: payload.account_bank,
            phone_number: payload.phone_number,
            fullname:     payload.fullname,
        }),
        });
        if ('result' in sent) return sent.result;
        const response = sent.response;

        if (!response || !isValidResponse(null, response)) {
            return uncertainV3('initiate USSD charge', payload.tx_ref, 'read_transaction_with_reference');
        }

        return buildChargeResponse(response, payload.tx_ref, 'ussd');
    } catch (error) {
        return uncertainV3('initiating USSD charge', payload.tx_ref, 'read_transaction_with_reference', error instanceof Error ? error.message : 'request error');
    }
}

export async function validateCharge(payload: { otp: string; flw_ref: string; type?: string }) {
    try {
        const response = await chargeClient.validateCharge({
            otp:     payload.otp,
            flw_ref: payload.flw_ref,
            type:    payload.type,
        });

        if (!response || !isValidResponse(null, response)) {
            return createErrorResponse(`Unable to validate charge with ref ${payload.flw_ref}`);
        }

        const chargeData = (response as any)?.data;
        const status     = chargeData?.status ?? 'unknown';

        const uiResource = createChargeUI({
            tx_ref:             chargeData?.tx_ref ?? payload.flw_ref,
            status,
            amount:             Number(chargeData?.amount ?? 0),
            currency:           chargeData?.currency ?? 'NGN',
            charge_type:        'validated',
            email:              chargeData?.customer?.email ?? '',
            fullname:           chargeData?.customer?.name,
            flw_ref:            payload.flw_ref,
            processor_response: chargeData?.processor_response,
        });

        const idNote = chargeData?.id ? ` Transaction ID: ${chargeData.id}.` : '';
        return {
            content: [
                { type: "text" as const, text: `Charge validated. Status: ${status}.${idNote}` },
                { type: "resource" as const, resource: uiResource },
            ],
        };
    } catch (error) {
        return createErrorResponse(`Error validating charge ${payload.flw_ref}: ${JSON.stringify(error)}`);
    }
}

// ─── Tool registration ────────────────────────────────────────────────────────

export function registerChargeTools() {
    server.tool(
        "charge_tokenized_card",
        [
            "Charge a card the customer saved on an earlier 3D Secure hosted checkout payment, using its token (POST /v3/tokenized-charges).",
            "Card numbers, CVVs and PINs are never taken: for a new card use create_checkout.",
            "By default the charge runs 3D Secure, so the customer must be present: if the result has a redirect, send the customer to it and wait.",
            "Charging without the customer present (recurring, merchant-initiated) needs Flutterwave to approve and enable it on the account.",
            "These two rules are Flutterwave's stated behaviour, not yet verified in Test Mode.",
        ].join(' '),
        ChargeTokenizedCardSchema,
        async (args) => {
            try {
                return await chargeTokenizedCard(withReference(args, 'tx_ref'));
            } catch (error) {
                return createErrorResponse(`Error occurred charging the saved card for ${args.email}`);
            }
        }
    );

    server.tool(
        "charge_bank_account",
        "Directly debit a customer's bank account with Flutterwave (NGN or GHS).",
        ChargeBankAccountSchema,
        async (args) => {
            try {
                return await chargeBankAccount(withReference(args, 'tx_ref'));
            } catch (error) {
                return createErrorResponse(`Error occurred charging bank account for ${args.email}`);
            }
        }
    );

    server.tool(
        "charge_mobile_money",
        "Charge a customer via mobile money with Flutterwave. Supports Ghana (GHS), Uganda (UGX), Rwanda (RWF), Zambia (ZMW), and Francophone Africa (XOF).",
        ChargeMobileMoneySchema,
        async (args) => {
            try {
                return await chargeMobileMoney(withReference(args, 'tx_ref'));
            } catch (error) {
                return createErrorResponse(`Error occurred charging mobile money for ${args.email}`);
            }
        }
    );

    server.tool(
        "charge_mpesa",
        "Charge a customer via M-Pesa (KES) with Flutterwave.",
        ChargeMpesaSchema,
        async (args) => {
            try {
                return await chargeMpesa(withReference(args, 'tx_ref'));
            } catch (error) {
                return createErrorResponse(`Error occurred charging M-Pesa for ${args.email}`);
            }
        }
    );

    server.tool(
        "charge_ussd",
        "Initiate a USSD charge for a customer in Nigeria (NGN) with Flutterwave.",
        ChargeUssdSchema,
        async (args) => {
            try {
                return await chargeUssd(withReference(args, 'tx_ref'));
            } catch (error) {
                return createErrorResponse(`Error occurred initiating USSD charge for ${args.email}`);
            }
        }
    );

    server.tool(
        "validate_charge",
        "Validate a pending Flutterwave charge using the OTP sent to the customer. Call this after a bank account charge returns auth mode 'otp'.",
        ValidateChargeSchema,
        async (args) => {
            try {
                return await validateCharge(args);
            } catch (error) {
                return createErrorResponse(`Error occurred validating charge ${args.flw_ref}`);
            }
        }
    );
}
