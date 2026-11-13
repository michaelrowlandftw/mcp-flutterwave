import { server } from '../server.js';
import { getApiVersion } from '../config/apiVersion.js';

/**
 * get_sandbox_scenarios: the documented ways to make the sandbox return a given
 * outcome. Sources: developer.flutterwave.com Testing pages (v4 and v3), 12 Nov 2026.
 * Test card numbers are left out on purpose: card data should not pass through
 * the AI model. Use hosted checkout or the docs page for card tests.
 */

/** Tools that take a sandbox_scenario argument (sent as X-Scenario-Key). */
export const SCENARIO_TOOLS = new Set([
  'create_charge', 'create_order', 'create_orchestrator_charge', 'create_orchestrator_order',
  'create_transfer', 'create_orchestrator_transfer',
]);

export const V4_SCENARIOS = {
  how: 'Pass sandbox_scenario on create_charge, create_order, create_transfer or the orchestrator tools. The server sends it as the X-Scenario-Key header. Sandbox only.',
  cards: {
    format: 'scenario:<auth>&issuer:<response>',
    auth: {
      auth_pin: 'PIN then OTP',
      auth_pin_3ds: 'PIN, then a fall-back to 3DS',
      auth_3ds: '3DS: returns a redirect URL',
      auth_avs: 'Billing address (AVS)',
    },
    default: 'No header: cards default to the noauth flow.',
    issuer_examples: [
      'approved', 'insufficient_funds', 'do_not_honor', 'incorrect_pin', 'expired_card', 'suspected_fraud',
      'issuer_unavailable', 'partial_approval', 'already_reversed', 'system_error',
    ],
    issuer_full_list: 'https://developer.flutterwave.com/v4/docs/testing',
    examples: ['scenario:auth_pin&issuer:approved', 'scenario:auth_3ds&issuer:approved', 'scenario:auth_avs&issuer:insufficient_funds', 'scenario:auth_pin&issuer:incorrect_pin'],
  },
  mobile_money: {
    default: 'No header: the customer approves on their phone.',
    'scenario:auth_redirect': 'Redirect to an authorisation page.',
  },
  transfers: {
    default: 'No header: the transfer stays pending and NO webhook is sent. Pass a scenario to get a final status and a webhook.',
    scenarios: [
      'successful', 'reversed', 'failed', 'account_verification_failed', 'transfer_amount_below_limit',
      'transfer_amount_exceeds_limit', 'daily_transfer_limit_exceeded', 'monthly_transfer_limit_exceeded',
      'disabled_transfer', 'duplicate_reference', 'insufficient_balance', 'payout_creation_failed',
    ].map((s) => `scenario:${s}`),
  },
  not_available: 'There is no documented timeout or 503 scenario. For those, run the server with FLW_FAULT=timeout or FLW_FAULT=503_no_id (sandbox only).',
};

export const V3_SCENARIOS = {
  how: 'v3 Test Mode has no scenario header. The outcome depends on the test data you send.',
  bank_account_charge_ng: {
    successful: 'Access Bank (044), accounts 0690000031 to 0690000040, OTP 12345',
    blacklisted_for_transfers: 'Access Bank (044), account 0690000036: transfers return 400',
    timeout: 'Account 9876543210',
    pending: 'Account 1234567890',
  },
  otp: { any: 'Any OTP passes', wrong_otp: '5548 (only inside the payment modal)' },
  mobile_money: { successful: 'Any mobile number, OTP 123456' },
  failure_references: {
    rule: 'A tx_ref ending in _PMCK_ST_F makes a Test Mode payment fail. Use it for failure tests only. Never use it as evidence for refunds or success paths, even if verify shows successful.',
  },
  cards: 'Test cards are on https://developer.flutterwave.com/docs/testing. They are not listed here, so card data stays out of the AI model.',
  known_limits: [
    'Settlements are not generated in Test Mode.',
    'Refund statuses can differ from live (for example completed-bank-transfer).',
    'Transfers can stay NEW or PENDING for minutes; webhooks can arrive about 10 minutes later.',
    'The sandbox bank list is shorter than live (598 against 703 banks, Nov 2026). Do not hard-code bank codes from it.',
  ],
};

export function sandboxScenarios(version = getApiVersion()) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ api_version: version, ...(version === 'v4' ? V4_SCENARIOS : V3_SCENARIOS) }, null, 2),
      },
    ],
  };
}

export function registerSandboxTools() {
  server.tool(
    'get_sandbox_scenarios',
    'List the documented sandbox test scenarios for this API version: v4 X-Scenario-Key values (cards, mobile money, transfers) or v3 Test Mode test data. Also gives the failure-reference rule and known sandbox limits. Test card numbers are not included.',
    async () => sandboxScenarios(),
  );
}
