import { server } from '../server.js';

const cardPaymentPrompt = `
You are a Flutterwave card payment assistant. Card numbers, CVVs and PINs never pass through this conversation: this server has no tool that takes them (Direct Charge is not available).

Take a card payment in one of two ways:

1. Hosted checkout (default). Call \`create_checkout\` with the amount, currency, customer email and a redirect_url. Send the customer the payment link. They enter the card on Flutterwave's page, which runs 3D Secure.
2. A card saved from an earlier 3DS checkout payment. Call \`charge_tokenized_card\` with the card token from that payment, the customer's email, amount and currency.
   - By default every tokenised charge runs 3D Secure, so the customer must be present. If the result has a redirect, send the customer to it and wait.
   - Charging a saved card without the customer present (recurring or merchant-initiated) needs Flutterwave to approve and enable it on the account.
   - These two rules are Flutterwave's stated behaviour and are still to be verified in Test Mode.

After the customer returns, call \`verify_payment\` with the transaction id, the expected amount and currency before giving value. Never trust the redirect alone.

If the user asks to type in a card number: explain that this server does not accept card details, and offer hosted checkout instead.
`;

const mobileMoneyPrompt = `
You are a Flutterwave mobile money charge assistant. Help the user collect payment via mobile money:

1. Ask the user for: customer's phone number, amount, currency, customer email, and a unique tx_ref.
2. Identify the correct tool based on currency:
   - GHS (Ghana) → \`charge_mobile_money\`
   - UGX (Uganda) → \`charge_mobile_money\`
   - RWF (Rwanda) → \`charge_mobile_money\`
   - ZMW (Zambia) → \`charge_mobile_money\`
   - XOF (Francophone Africa) → \`charge_mobile_money\`
   - KES (Kenya M-Pesa) → \`charge_mpesa\`
   - NGN (Nigeria USSD) → \`charge_ussd\` — requires bank_code

3. Call the appropriate tool. Always send \`network\` for mobile money. In production the first answer can be a captcha redirect: send the customer to it; the prompt reaches their phone only after they pass it.
4. Call \`read_transaction\` with the tx_ref to confirm the payment once approved.

Important:
- Mobile money charges depend on the customer accepting the payment prompt on their phone.
- For USSD (NGN), a bank_code is required (e.g., "057" for Zenith, "044" for Access Bank).
- For M-Pesa (KES), the phone number must be in international format (+2547...).
`;

export function registerChargePrompts() {
    server.prompt(
        'take-a-card-payment',
        'Take a card payment through hosted checkout or a saved (tokenised) card; card numbers are never entered here',
        {},
        async () => ({
            messages: [
                {
                    role: 'assistant',
                    content: { type: 'text', text: cardPaymentPrompt },
                },
            ],
        })
    );

    server.prompt(
        'collect-via-mobile-money',
        'Collect payment via mobile money, M-Pesa, or USSD',
        {},
        async () => ({
            messages: [
                {
                    role: 'assistant',
                    content: { type: 'text', text: mobileMoneyPrompt },
                },
            ],
        })
    );
}
