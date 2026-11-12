import { describe, expect, it, vi } from 'vitest';
import { acceptedToolsFor } from '../../config/acceptedTools.js';
import { getApiVersion } from '../../config/apiVersion.js';
import { parseFlutterwaveEnv } from '../../config/env.js';

describe('v4 api version selection', () => {
  it('defaults to v4 when FLW_API_VERSION is unset', () => {
    expect(getApiVersion({})).toBe('v4');
    expect(getApiVersion({ FLW_API_VERSION: '' })).toBe('v4');
  });

  it('keeps v3 when asked, or when only a v3 secret key is set', () => {
    expect(getApiVersion({ FLW_API_VERSION: 'v3' })).toBe('v3');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getApiVersion({ FLW_SECRET_KEY: 'FLWSECK_TEST-x' })).toBe('v3');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/Set FLW_API_VERSION=v3/));
    warn.mockRestore();
    expect(
      getApiVersion({ FLW_SECRET_KEY: 'FLWSECK_TEST-x', FLW_CLIENT_ID: 'c' }),
    ).toBe('v4');
    expect(acceptedToolsFor('v3')).toContain('charge_card');
    expect(acceptedToolsFor('v3')).not.toContain('create_card_payment_method');
  });

  it('selects the v4 tool allowlist only', () => {
    expect(getApiVersion({ FLW_API_VERSION: 'v4' })).toBe('v4');
    expect(acceptedToolsFor('v4')).toEqual([
      'create_customer',
      'create_card_payment_method',
      'create_charge',
      'get_charge',
      'create_refund',
      'get_customer',
      'get_refund',
      'get_payment_method',
      'list_customers',
      'search_customers',
      'update_customer',
      'list_charges',
      'update_charge',
      'list_refunds',
      'list_payment_methods',
      'get_fees',
      'get_banks',
      'get_mobile_networks',
      'get_wallet_balance',
      'list_wallet_balances',
      'get_wallet_statement',
      'resolve_wallet_account',
      'list_settlements',
      'get_settlement',
      'list_chargebacks',
      'get_chargeback',
      'create_chargeback',
      'update_chargeback',
      'create_order',
      'get_order',
      'create_virtual_account',
      'get_virtual_account',
      'quote_transfer_rate',
      'get_transfer_rate',
      'create_orchestrator_charge',
      'create_orchestrator_order',
      'create_orchestrator_transfer',
      'resend_webhook',
      'get_bank_branches',
      'resolve_bank_account',
      'list_orders',
      'update_order',
      'list_virtual_accounts',
      'update_virtual_account',
      'list_transfer_recipients',
      'create_transfer_recipient',
      'get_transfer_recipient',
      'delete_transfer_recipient',
      'list_transfer_senders',
      'create_transfer_sender',
      'get_transfer_sender',
      'delete_transfer_sender',
      'create_transfer',
      'get_transfer',
      'list_transfers',
      'update_transfer',
      'retry_transfer',
      'verify_payment',
      'verify_payout',
      'verify_webhook',
    ]);
  });

  it('falls back to v4 for an unrecognized version', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(getApiVersion({ FLW_API_VERSION: 'v5' })).toBe('v4');
    warn.mockRestore();
  });

  it('requires the v3 secret key and not v4 credentials', () => {
    expect(() => parseFlutterwaveEnv({ FLW_API_VERSION: 'v3' })).toThrow('Invalid environment variables');
    const config = parseFlutterwaveEnv({ FLW_API_VERSION: 'v3', FLW_SECRET_KEY: 'sk_test' });
    expect(config.apiVersion).toBe('v3');
    expect(config.flutterwave.secretKey).toBe('sk_test');
  });

  it('requires v4 credentials and not the v3 secret key', () => {
    expect(() =>
      parseFlutterwaveEnv({ FLW_API_VERSION: 'v4', FLW_SECRET_KEY: 'sk_test' }),
    ).toThrow('Invalid environment variables');

    const config = parseFlutterwaveEnv({
      FLW_API_VERSION: 'v4',
      FLW_CLIENT_ID: 'client',
      FLW_CLIENT_SECRET: 'secret',
      FLW_ENCRYPTION_KEY_V4: 'key',
    });
    expect(config.apiVersion).toBe('v4');
    expect(config.flutterwave.clientId).toBe('client');
    expect(config.flutterwave.encryptionKeyV4).toBe('key');
  });

  it('does not need the v4 encryption key (raw card tools are off by default)', () => {
    const config = parseFlutterwaveEnv({ FLW_CLIENT_ID: 'c', FLW_CLIENT_SECRET: 's' });
    expect(config.apiVersion).toBe('v4');
    expect(config.flutterwave.encryptionKeyV4).toBe('');
  });
});
