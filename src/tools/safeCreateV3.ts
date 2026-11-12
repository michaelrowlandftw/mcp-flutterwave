import Flutterwave from '../client/index.js';
import { uncertainV3, V3Rejected } from '../utils/reference.js';
import { lookupDelays, sleep } from './v4/safeCreate.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
export type V3Lookup = (reference: string) => Promise<unknown | null>;

const text = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

const reasonOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** One call. A 4xx is thrown as V3Rejected; no reply or any other error is "unclear". */
async function tryOnce<T>(send: () => Promise<T | undefined>): Promise<{ response: T } | { reason: string }> {
  try {
    const response = await send();
    return response ? { response } : { reason: 'no reply (timeout, 5xx or network error)' };
  } catch (error) {
    if (error instanceof V3Rejected) throw error;
    return { reason: reasonOf(error) };
  }
}

/**
 * Send a v3 create safely, the same way as safeCreate does for v4.
 * - A 4xx means nothing was created: return "failed", no retry.
 * - An unclear result: look the record up by reference with backoff. Found: return it.
 *   Not found: retry once with the same reference. Still unclear: "unknown".
 * - Without a lookup, an unclear result is "unknown" with no retry.
 * On success the caller gets the raw response and builds its usual reply.
 */
export async function sendV3Safely<T>(opts: {
  action: string;
  reference?: string;
  lookupTool: string;
  lookup?: V3Lookup;
  send: () => Promise<T | undefined>;
}): Promise<{ response: T } | { result: ToolResult }> {
  const refused = (error: unknown) => ({
    result: text({
      status: 'failed',
      reference: opts.reference ?? null,
      reason: reasonOf(error),
      note: 'Flutterwave refused the request, so nothing was created. Fix the input before you try again.',
    }),
  });

  let first;
  try {
    first = await tryOnce(opts.send);
  } catch (error) {
    return refused(error);
  }
  if ('response' in first) return first;
  if (!opts.lookup || !opts.reference) {
    return { result: uncertainV3(opts.action, opts.reference, opts.lookupTool, first.reason) };
  }

  for (const delay of lookupDelays()) {
    await sleep(delay);
    const found = await opts.lookup(opts.reference).catch(() => null);
    if (found) {
      return {
        result: text({
          status: 'found_after_uncertain_create',
          reference: opts.reference,
          reason: first.reason,
          note: 'The create call did not confirm, but a record with this reference exists. It was not created twice.',
          body: { data: found },
        }),
      };
    }
  }

  let second;
  try {
    second = await tryOnce(opts.send);
  } catch (error) {
    // A refusal on the retry may mean "duplicate reference": the first call may have worked.
    second = { reason: reasonOf(error) };
  }
  if ('response' in second) return second;
  return {
    result: uncertainV3(opts.action, opts.reference, opts.lookupTool, `${second.reason}; retried once with the same reference`),
  };
}

// ─── Lookups by reference ────────────────────────────────────────────────────

const dataOf = (body: unknown) => {
  const b = body as { status?: string; data?: unknown } | undefined;
  return b?.status === 'success' && b.data ? b.data : null;
};

/** Charges: GET /transactions/verify_by_reference?tx_ref=... */
export const lookupV3Transaction: V3Lookup = async (txRef) => {
  const data = dataOf(await Flutterwave.transactions().get_with_reference(txRef)) as { tx_ref?: string } | null;
  return data?.tx_ref === txRef ? data : null;
};

/** Transfers (bank and stablecoin): GET /transfers?reference=... */
export const lookupV3Transfer: V3Lookup = async (reference) => {
  const rows = dataOf(await Flutterwave.transfers().getByReference(reference));
  return Array.isArray(rows) ? rows.find((row) => row?.reference === reference) ?? null : null;
};

/** Bills: GET /bills/{reference}/status */
export const lookupV3Bill: V3Lookup = async (reference) =>
  dataOf(await Flutterwave.billPayments().getBillStatus(reference));
