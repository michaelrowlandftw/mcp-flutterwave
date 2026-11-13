/**
 * Tools that take a full card number, CVV or PIN as tool input.
 * That data passes through the AI model, which puts most merchants in
 * PCI DSS scope. They are off unless the user switches them on.
 */
export const RAW_CARD_TOOLS = new Set<string>([
  'charge_card',
  'create_card_payment_method',
  'create_orchestrator_charge',
  'create_orchestrator_order',
]);

export const RAW_CARD_SWITCH_HINT =
  'Start the server with --enable-raw-card-tools or set FLW_ENABLE_RAW_CARD_TOOLS=true to register them. Prefer hosted checkout (create_checkout, create_order) or saved payment methods instead.';

export function rawCardToolsAllowedByEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FLW_ENABLE_RAW_CARD_TOOLS === 'true';
}
