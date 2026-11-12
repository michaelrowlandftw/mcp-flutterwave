import { flwV4Fetch } from '../../client/v4/http.js';
import { toQueryString } from './httpResult.js';

type ToolResult = { content: Array<{ type: 'text'; text: string }> };
export type Lookup = (reference: string) => Promise<unknown | null>;

type Attempt =
  | { kind: 'ok'; status: number; payload: unknown }
  | { kind: 'uncertain'; reason: string };

const DEFAULT_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];

/** Backoff between lookups. FLW_LOOKUP_DELAYS_MS="0,0" makes tests instant. */
function lookupDelays(): number[] {
  const raw = process.env.FLW_LOOKUP_DELAYS_MS;
  if (!raw) return DEFAULT_DELAYS_MS;
  return raw.split(',').map((v) => Math.max(0, Number(v) || 0));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parse(raw: string): unknown {
  try {
    return raw === '' ? null : JSON.parse(raw);
  } catch {
    return raw;
  }
}

function text(value: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

function hasId(payload: unknown): boolean {
  const data = (payload as { data?: { id?: unknown } } | null)?.data;
  return typeof data?.id === 'string' || typeof data?.id === 'number';
}

async function attempt(path: string, body: unknown, key: string, label: string): Promise<Attempt> {
  let response: Response;
  try {
    response = await flwV4Fetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'X-Idempotency-Key': key },
    });
  } catch (error) {
    return { kind: 'uncertain', reason: error instanceof Error ? error.message : String(error) };
  }
  const raw = await response.text();
  if (response.status >= 500) {
    return { kind: 'uncertain', reason: `HTTP ${response.status}` };
  }
  if (!response.ok) {
    // A 4xx is a definite "not created": report it as before.
    throw new Error(`Flutterwave v4 ${label} request failed: ${response.status} ${raw}`);
  }
  const payload = parse(raw);
  if (!hasId(payload)) {
    return { kind: 'uncertain', reason: `HTTP ${response.status} with no record ID` };
  }
  return { kind: 'ok', status: response.status, payload };
}

/**
 * POST a create safely.
 * - Sends X-Idempotency-Key, set to the reference when there is one.
 * - A timeout, a 5xx or a 2xx without an ID is "uncertain": the record may exist.
 *   Look it up by reference with backoff. Found: return it. Not found after every
 *   lookup: retry once with the same reference and key. Still uncertain: "unknown".
 * - Without a lookup, an uncertain result is returned as "unknown" with no retry.
 */
export async function safeCreate(opts: {
  path: string;
  body: unknown;
  label: string;
  reference?: string;
  lookup?: Lookup;
  lookupHint: string;
}): Promise<ToolResult> {
  const key = opts.reference ?? `mcp-idem-${crypto.randomUUID()}`;
  const first = await attempt(opts.path, opts.body, key, opts.label);
  if (first.kind === 'ok') {
    return text({ status: first.status, body: first.payload });
  }

  const unknown = (reason: string, extra: Record<string, unknown> = {}) =>
    text({
      status: 'unknown',
      reference: opts.reference ?? null,
      reason,
      next_step: `Do not call this create tool again. ${opts.lookupHint}`,
      ...extra,
    });

  if (!opts.lookup || !opts.reference) {
    return unknown(first.reason);
  }

  for (const delay of lookupDelays()) {
    await sleep(delay);
    const found = await opts.lookup(opts.reference).catch(() => null);
    if (found) {
      return text({
        status: 'found_after_uncertain_create',
        reference: opts.reference,
        reason: first.reason,
        note: 'The create call did not confirm, but a record with this reference exists. It was not created twice.',
        body: { data: found },
      });
    }
  }

  const second = await attempt(opts.path, opts.body, key, opts.label);
  if (second.kind === 'ok') {
    return text({
      status: second.status,
      body: second.payload,
      note: `The first call was uncertain (${first.reason}) and no record with this reference existed, so the server retried once.`,
    });
  }
  return unknown(second.reason, { retried_once: true });
}

// ─── Lookups by reference ────────────────────────────────────────────────────

async function getJson(path: string): Promise<any> {
  const response = await flwV4Fetch(path, { method: 'GET' });
  if (!response.ok) throw new Error(`lookup ${path} failed: ${response.status}`);
  return parse(await response.text());
}

function match(rows: unknown, reference: string): unknown | null {
  if (!Array.isArray(rows)) return null;
  return rows.find((row) => (row as { reference?: string })?.reference === reference) ?? null;
}

/** Charges and virtual accounts filter by reference on the server. */
export const lookupCharge: Lookup = async (reference) =>
  match((await getJson(`/charges${toQueryString({ reference })}`))?.data, reference);

export const lookupVirtualAccount: Lookup = async (reference) =>
  match((await getJson(`/virtual-accounts${toQueryString({ reference })}`))?.data, reference);

/** Orders have no reference filter: scan the newest pages. */
export const lookupOrder: Lookup = async (reference) => {
  for (let page = 1; page <= 3; page++) {
    const body = await getJson(`/orders${toQueryString({ page, size: 50 })}`);
    const hit = match(body?.data, reference);
    if (hit) return hit;
    if (!Array.isArray(body?.data) || body.data.length < 50) break;
  }
  return null;
};

/** Transfers have no reference filter: scan today's and yesterday's transfers (UTC, date only). */
export const lookupTransfer: Lookup = async (reference) => {
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  let next: string | undefined;
  for (let page = 0; page < 5; page++) {
    const body = await getJson(`/transfers${toQueryString({ from: day(1), to: day(0), size: 50, next })}`);
    const data = body?.data;
    const rows = Array.isArray(data) ? data : data?.transfers ?? data?.items;
    const hit = match(rows, reference);
    if (hit) return hit;
    next = data?.cursor?.has_more_items ? data.cursor.next : undefined;
    if (!next) break;
  }
  return null;
};
