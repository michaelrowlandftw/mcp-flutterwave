import { describe, expect, it } from 'vitest';
import { newReference, uncertainV3, withReference } from '../utils/reference.js';

describe('references', () => {
  it('are unique and fit v4 reference and idempotency rules', () => {
    const refs = new Set(Array.from({ length: 1000 }, newReference));
    expect(refs.size).toBe(1000);
    for (const ref of refs) expect(ref).toMatch(/^[a-zA-Z0-9-]{12,42}$/);
  });

  it('fill only a missing or empty field', () => {
    expect(withReference({ tx_ref: 'mine' }, 'tx_ref').tx_ref).toBe('mine');
    expect(withReference({ tx_ref: '' }, 'tx_ref').tx_ref).toMatch(/^mcp-/);
    expect(withReference({}, 'reference').reference).toMatch(/^mcp-/);
  });

  it('v3 failures report unknown with a lookup step', () => {
    const out = JSON.parse(uncertainV3('pay bill', 'mcp-x', 'get_bill_status').content[0].text);
    expect(out).toMatchObject({ status: 'unknown', reference: 'mcp-x' });
    expect(out.next_step).toMatch(/get_bill_status/);
  });
});
