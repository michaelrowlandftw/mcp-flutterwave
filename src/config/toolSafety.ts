import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

/**
 * One table for tool safety. Read-only mode, confirmation, amount caps and
 * MCP annotations all read from it, so a tool is classified once.
 */

/** Moves money, or changes a payment, payout or dispute. */
export const MONEY_MOVING = new Set<string>([
  'charge_bank_account', 'charge_card', 'charge_mobile_money', 'charge_mpesa', 'charge_ussd', 'validate_charge',
  'create_charge', 'update_charge', 'create_order', 'update_order',
  'create_orchestrator_charge', 'create_orchestrator_order', 'create_orchestrator_transfer',
  'create_transfer', 'update_transfer', 'retry_transfer',
  'create_refund', 'create_chargeback', 'update_chargeback',
  'pay_bill', 'initiate_fx_trade', 'send_stablecoin', 'convert_to_stablecoin',
]);

/** Removes or disables something. Repeating it has no further effect. */
export const DELETES = new Set<string>(['delete_transfer_recipient', 'delete_transfer_sender', 'disable_checkout']);

/** Writes that neither move money nor delete. */
export const OTHER_WRITES = new Set<string>([
  'create_beneficiary', 'create_card_payment_method', 'create_checkout', 'create_customer', 'create_payment_plan',
  'create_transfer_recipient', 'create_transfer_sender', 'create_virtual_account', 'initiate_bvn_verification',
  'request_fx_quote', 'resend_transaction_webhook', 'resend_webhook', 'update_customer', 'update_virtual_account',
]);

/** Writes where repeating the same call leaves the same state. */
const IDEMPOTENT_WRITES = new Set<string>(['update_customer', 'update_virtual_account']);

/** Reads: get, list, read, search, resolve and verify tools, plus a few checks and quotes. */
const READ_EXTRA = new Set<string>([
  'quote_transfer_rate', 'validate_bill_customer', 'verify_card_bin', 'search_customers',
]);

export function isReadOnlyTool(name: string): boolean {
  return /^(get|list|read|resolve|verify)_/.test(name) || READ_EXTRA.has(name);
}

export function isClassified(name: string): boolean {
  return isReadOnlyTool(name) || MONEY_MOVING.has(name) || DELETES.has(name) || OTHER_WRITES.has(name);
}

/** MCP tool annotations. An unclassified tool is treated as a money-moving write. */
export function annotationsFor(name: string): ToolAnnotations {
  if (isReadOnlyTool(name)) {
    return { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
  }
  if (DELETES.has(name)) {
    return { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
  }
  if (OTHER_WRITES.has(name)) {
    return { readOnlyHint: false, destructiveHint: false, idempotentHint: IDEMPOTENT_WRITES.has(name), openWorldHint: true };
  }
  return { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true };
}
