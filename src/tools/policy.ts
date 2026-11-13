import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Options } from '../types/index.js';
import { RAW_CARD_TOOLS } from '../config/rawCardTools.js';
import { describeEnvironment, VERIFY_HINT } from '../verify/environment.js';
import { annotationsFor, isReadOnlyTool, MONEY_MOVING } from '../config/toolSafety.js';
import { capError, guardMoneyTool, isLive } from './confirm.js';
import { z } from 'zod';
import { redactResult } from '../utils/redact.js';
import { SCENARIO_TOOLS } from './sandbox.js';
import { SCENARIO_KEY, withScenario } from '../client/v4/scenario.js';
import { getApiVersion } from '../config/apiVersion.js';

/** Tools that create payments or payouts, or resend webhooks: they all point to the verify tools. */
const GIVES_VALUE_SIGNAL = /^(create_|charge_|pay_bill$|send_stablecoin$|convert_to_stablecoin$|initiate_fx_trade$|resend_(transaction_)?webhook$|retry_transfer$)/;

/** The SDK keeps registered tools in a private map keyed by name. */
export function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
}

/**
 * Apply start-up options to the tools already registered.
 * --tools: keep only the tools listed ("all" keeps every tool).
 * Raw card tools stay off unless options.rawCardTools is true.
 * Read-only mode keeps only tools that read data.
 * Returns the names of the tools that stay registered.
 */
/**
 * Callback and redirect URLs, at any depth, must be https (review L5, N8).
 * http://localhost and http://127.0.0.1 are allowed outside live, for local testing.
 * FLW_ALLOWED_URL_HOSTS (comma-separated) restricts the hosts further.
 */
const URL_FIELDS = new Set(['callback_url', 'redirect_url']);

function checkUrls(value: unknown, depth = 0): void {
  if (!value || typeof value !== 'object' || depth > 8) return;
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (URL_FIELDS.has(key) && inner !== undefined) checkUrl(key, inner);
    else checkUrls(inner, depth + 1);
  }
}

function checkUrl(key: string, value: unknown): void {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${key} must be an https URL.`);
  }
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (typeof value !== 'string' || /\s/.test(value) || !(url.protocol === 'https:' || (local && !isLive()))) {
    throw new Error(`${key} must be an https URL.`);
  }
  const allowed = (process.env.FLW_ALLOWED_URL_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !local && !allowed.includes(url.hostname.toLowerCase())) {
    throw new Error(`${key} host ${url.hostname} is not in FLW_ALLOWED_URL_HOSTS.`);
  }
}

function hasPin(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  return Object.entries(value as Record<string, unknown>).some(
    ([k, v]) => /^(pin|encrypted_pin)$/i.test(k) || hasPin(v, depth + 1),
  );
}

export function applyToolPolicy(server: McpServer, options: Options): string[] {
  const wanted = new Set((options.tools ?? ['all']).map((tool) => tool.trim()));
  const keepAll = wanted.has('all');

  for (const [name, tool] of Object.entries(registeredTools(server))) {
    const cardBlocked = RAW_CARD_TOOLS.has(name) && options.rawCardTools !== true;
    const writeBlocked = options.readOnly === true && !isReadOnlyTool(name);
    if (cardBlocked || writeBlocked || (!keepAll && !wanted.has(name))) {
      tool.remove();
    }
  }

  const environment = describeEnvironment();
  for (const [name, tool] of Object.entries(registeredTools(server))) {
    if (GIVES_VALUE_SIGNAL.test(name) && tool.description && !tool.description.includes('verify_payment')) {
      tool.description = `${tool.description} ${VERIFY_HINT}`;
    }
    tool.annotations = { ...tool.annotations, ...annotationsFor(name) };
    if (SCENARIO_TOOLS.has(name) && getApiVersion() === 'v4') {
      const shape = (tool.inputSchema as unknown as { shape?: z.ZodRawShape } | undefined)?.shape;
      if (shape) {
        (tool as { inputSchema: unknown }).inputSchema = z.object({
          ...shape,
          sandbox_scenario: z
            .string()
            .regex(SCENARIO_KEY, 'Use scenario:<value> or scenario:<value>&issuer:<value>')
            .optional()
            .describe('Sandbox only: force an outcome, for example scenario:successful or scenario:auth_pin&issuer:approved. See get_sandbox_scenarios.'),
        });
      }
      const inner = tool.handler as (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
      (tool as { handler: unknown }).handler = async (args: Record<string, unknown>, extra: unknown) => {
        const { sandbox_scenario, ...rest } = args ?? {};
        return withScenario(sandbox_scenario as string | undefined, () => inner(rest, extra));
      };
    }
    // request_fx_quote sets the size of the FX trade, so it gets the amount cap too.
    if (name === 'request_fx_quote') {
      const inner = tool.handler as (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
      (tool as { handler: unknown }).handler = async (args: Record<string, unknown>, extra: unknown) => {
        const cap = capError(args ?? {}, process.env, name);
        return cap ? { isError: true, content: [{ type: 'text', text: cap }] } : inner(args, extra);
      };
    }
    if (MONEY_MOVING.has(name)) {
      // The SDK stores a zod/mini object (no .extend), so rebuild it from its shape.
      const shape = (tool.inputSchema as unknown as { shape?: z.ZodRawShape } | undefined)?.shape;
      if (shape) {
        (tool as { inputSchema: unknown }).inputSchema = z.object({
          ...shape,
          confirmation_token: z
            .string()
            .optional()
            .describe('Leave empty on the first call. The server returns a token after the user confirms the summary.'),
        });
      }
      tool.description = `${tool.description ?? ''} Moves money: the server asks for confirmation first, and refuses amounts above FLW_MAX_AMOUNT when set.`;
      (tool as { handler: unknown }).handler = guardMoneyTool(
        server,
        name,
        tool.handler as (args: Record<string, unknown>, extra: unknown) => Promise<unknown>,
      );
    }
    // Every result says which environment it came from, and is redacted:
    // no keys, tokens, secrets or full card numbers leave the server.
    const handler = tool.handler as (...args: unknown[]) => Promise<{ content?: unknown[] }>;
    (tool as { handler: unknown }).handler = async (...args: unknown[]) => {
      let out: { content?: unknown[]; isError?: boolean };
      try {
        const input = (args[0] ?? {}) as Record<string, unknown>;
        checkUrls(input);
        // update_charge can carry authorization.pin; no tool encrypts a PIN, so a raw
        // PIN would be sent. Only with the raw card tools switched on (review L1, N10).
        if (name === 'update_charge' && options.rawCardTools !== true && hasPin(input)) {
          throw new Error('update_charge with a PIN needs the raw card tools switch (--enable-raw-card-tools). Card PINs should not pass through the AI model.');
        }
        out = await handler(...args);
      } catch (error) {
        out = { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
      }
      if (out && Array.isArray(out.content)) {
        out.content.push({ type: 'text', text: JSON.stringify({ flutterwave_environment: environment }) });
      }
      return redactResult(out);
    };
  }

  return Object.keys(registeredTools(server));
}
