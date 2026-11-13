import { randomUUID } from 'node:crypto';

/** Keep in step with package.json (a test checks this). */
export const SERVER_VERSION = '2.0.0';

/** Sent on every API call, so Flutterwave logs can count MCP use. */
export const USER_AGENT = `mcp-flutterwave/${SERVER_VERSION}`;

/** A fresh trace ID per request: "mcp-flutterwave-" plus a UUID (52 characters, inside v4's 12 to 255). */
export function newTraceId(): string {
  return `mcp-flutterwave-${randomUUID()}`;
}

/** Set the usage headers, keeping a trace ID the caller already set. */
export function setUsageHeaders(headers: Headers): Headers {
  headers.set('User-Agent', USER_AGENT);
  if (!headers.has('X-Trace-Id')) headers.set('X-Trace-Id', newTraceId());
  return headers;
}
