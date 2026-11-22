import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normaliseStatus, type StatusObject } from '../verify/statusMaps.js';

/**
 * RFC DX-RFC-001 open item 6.6: status logic replayed against real values.
 * The fixture holds the status enums of the candidate V3 spec, which were built
 * from measured Test Mode and production responses (each value lists its source).
 */
const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/candidate-v3-status-enums.json', import.meta.url)), 'utf8'),
) as { enums: Record<string, { enum: string[]; 'x-sources': Record<string, string[]> }> };

const OBJECT_FOR: Record<string, StatusObject> = {
  TransactionStatus: 'collection',
  TransferStatus: 'payout',
  RefundStatus: 'refund',
  SettlementStatus: 'settlement',
};

describe('v3 status maps against the candidate spec enums', () => {
  for (const [schema, object] of Object.entries(OBJECT_FOR)) {
    it(`maps every ${schema} value (${object})`, () => {
      const values = fixture.enums[schema].enum;
      expect(values.length).toBeGreaterThan(0);
      const unmapped = values.filter((v) => normaliseStatus('v3', object, v).normalised === 'unknown');
      expect(unmapped).toEqual([]);
    });
  }

  it('treats pending and NEW as not final, and only successful values as paid', () => {
    expect(normaliseStatus('v3', 'collection', 'pending').normalised).toBe('pending');
    expect(normaliseStatus('v3', 'collection', 'voided').normalised).toBe('failed');
    expect(normaliseStatus('v3', 'payout', 'NEW').normalised).toBe('pending');
    // Open enums: a value the spec does not list is unknown, never success.
    expect(normaliseStatus('v3', 'collection', 'completed').normalised).toBe('unknown');
    expect(normaliseStatus('v3', 'payout', 'successful').normalised).toBe('unknown');
  });
});
