import { randomUUID } from 'node:crypto';

/**
 * A unique reference for a create call: "mcp-" plus 20 hex characters (24 in all).
 * It fits every v4 reference rule (alphanumeric and hyphens, 6 to 42 characters)
 * and the X-Idempotency-Key rule (12 to 255 characters).
 */
export function newReference(): string {
  return `mcp-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/** Shared wording for create tools, so every description gives the same retry rule. */
export const RETRY_GUIDANCE =
  'Leave reference empty to let the server create a unique one, and keep the reference it returns. If the result is "unknown" (a timeout, a 5xx, or no ID), do not call this tool again: look the record up by that reference first. The server already does this and retries once only when no record exists.';

/** Fill a missing reference field (tx_ref or reference) with a new unique one. */
export function withReference<T extends object, K extends string>(
  args: T,
  key: K,
): T & Record<K, string> {
  const current = (args as Record<string, unknown>)[key];
  return { ...args, [key]: typeof current === 'string' && current !== '' ? current : newReference() } as T &
    Record<K, string>;
}

/**
 * v3 client calls return nothing on any failure, so the server cannot tell
 * "not created" from "created, but the reply was lost". Treat both as unknown.
 */
export function uncertainV3(action: string, reference: string | undefined, lookupTool: string, detail?: string) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            status: 'unknown',
            reference: reference ?? null,
            reason: `The ${action} call returned no confirmation${detail ? ` (${detail})` : ''}. It may still have been processed.`,
            next_step: `Do not call this tool again. Check with ${lookupTool} using this reference first. Retry with the same reference only if no record exists.`,
          },
          null,
          2,
        ),
      },
    ],
  };
}
