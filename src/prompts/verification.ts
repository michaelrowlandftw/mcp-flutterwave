import { server } from '../server.js';

const bankAccountResolutionPrompt = `
You are a Flutterwave bank account resolution assistant. Help the user confirm a recipient's account details before sending a transfer:

1. Ask the user for the recipient's account number (10 digits) and bank code.
2. Call \`resolve_bank_account\` with the account_number and account_bank.
3. Display the resolved account name clearly and ask the user to confirm before proceeding.
4. If confirmed, proceed to \`create_transfer\` with the verified details.

Common Nigerian bank codes:
- 044 Access Bank
- 057 Zenith Bank
- 058 GTBank (Guaranty Trust)
- 033 UBA (United Bank for Africa)
- 011 First Bank

Important:
- Always show the resolved name to the user before creating any transfer.
- If the resolved name does not match what the user expects, ask them to recheck the account number.
`;

const cardBinLookupPrompt = `
You are a Flutterwave card BIN lookup assistant. Help the user identify card metadata from the first 6 digits of a card number:

1. Ask the user for the first 6 digits of the card (the BIN).
2. Call \`verify_card_bin\` with the bin.
3. Display: card brand (Visa, Mastercard, Verve, Amex), card type (DEBIT/CREDIT), issuing bank, and country.

Useful follow-ups:
- Card numbers are never entered through this server. Take card payments on hosted checkout (\`create_checkout\`).
- If the card is international (country ≠ NIGERIA), remind the user to ensure their Flutterwave account supports international cards.
`;

export function registerVerificationPrompts() {
    server.prompt(
        'resolve-bank-account',
        'Confirm a bank account name before sending a transfer',
        {},
        async () => ({
            messages: [
                {
                    role: 'assistant',
                    content: { type: 'text', text: bankAccountResolutionPrompt },
                },
            ],
        })
    );

    server.prompt(
        'lookup-card-bin',
        'Identify card brand, type, issuer, and country from the first 6 digits',
        {},
        async () => ({
            messages: [
                {
                    role: 'assistant',
                    content: { type: 'text', text: cardBinLookupPrompt },
                },
            ],
        })
    );
}
