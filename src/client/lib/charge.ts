import { throwIfRejected, V3Rejected } from "../../utils/reference.js";
import { chargeClient as client } from "../http/index.js";
import type { paths } from "../types/v3/charge.js";

type ChargeType = paths["/charges"]["post"]["parameters"]["query"]["type"];

type ChargePayload = paths["/charges"]["post"]["requestBody"]["content"]["application/json"];

type ChargeResponse = paths["/charges"]["post"]["responses"]["200"]["content"]["application/json"];

type TokenizedChargePayload = paths["/tokenized-charges"]["post"]["requestBody"]["content"]["application/json"];

type ValidateChargePayload = paths["/validate-charge"]["post"]["requestBody"]["content"]["application/json"];


/**
 * Charge a bank account (NGN or GHS).
 * https://developer.flutterwave.com/v3.0.0/reference/charge-uk-bank-accounts
 */
async function chargeBankAccount(payload: ChargePayload): Promise<ChargeResponse | undefined> {
    const supportedCurrencies = ["NGN", "GHS", "GBP", "EUR"];
    const UKEURSupportedCurrencies = ["GBP", "EUR"];
    let type: ChargeType = 'mono';

    if (payload.currency && !supportedCurrencies.includes(payload.currency)) {
        throw new V3Rejected(`Currency ${payload.currency} is not supported for bank account charges. Supported currencies: ${supportedCurrencies.join(", ")}`);
    }

    if (payload.currency && UKEURSupportedCurrencies.includes(payload.currency)) {
        type = 'debit_uk_account';
    }

    const { data, error, response } = await client.POST("/charges", {
        params: { query: { type } },
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Charge via mobile money (Ghana, Uganda, Rwanda, Zambia, Francophone Africa).
 * https://developer.flutterwave.com/reference/mobile-money-ghana
 */
async function chargeMobileMoney(type: ChargeType, payload: ChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error, response } = await client.POST("/charges", {
        params: { query: { type } },
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Charge via M-Pesa (KES).
 * https://developer.flutterwave.com/reference/mpesa
 */
async function chargeMpesa(payload: ChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error, response } = await client.POST("/charges", {
        params: { query: { type: "mpesa" } },
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Charge via USSD (NGN only).
 * https://developer.flutterwave.com/reference/ussd
 */
async function chargeUssd(payload: ChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error, response } = await client.POST("/charges", {
        params: { query: { type: "ussd" } },
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Charge via Fawry.
 * https://developer.flutterwave.com/v3.0.0/reference/charge-via-fawrypay
 */
async function chargeFawry(payload: ChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error, response } = await client.POST("/charges", {
        params: { query: { type: "fawry_pay" } },
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Charge via Capitec.
 * https://developer.flutterwave.com/v3.0.0/reference/charge-via-capitec
 */
async function chargeCapitec(payload: ChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error, response } = await client.POST("/charges", {
        params: { query: { type: "capitec" } },
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Charge a card saved from an earlier 3DS checkout payment (POST /v3/tokenized-charges).
 * No card number, CVV or PIN is sent: only the token from that payment.
 * https://developer.flutterwave.com/v3.0.0/docs/tokenized-charge
 */
async function chargeTokenized(payload: TokenizedChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error, response } = await client.POST("/tokenized-charges", {
        body: payload,
    });

    if (error) {
        throwIfRejected(response, error);
        console.error(error);
        return;
    }

    return data;
}

/**
 * Validate a pending charge using an OTP.
 * https://developer.flutterwave.com/reference/validate-charge
 */
async function validateCharge(payload: ValidateChargePayload): Promise<ChargeResponse | undefined> {
    const { data, error } = await client.POST("/validate-charge", {
        body: payload,
    });

    if (error) {
        console.error(error);
        return;
    }

    return data;
}

export default {
    chargeTokenized,
    chargeBankAccount,
    chargeMobileMoney,
    chargeMpesa,
    chargeUssd,
    chargeFawry,
    validateCharge,
};
