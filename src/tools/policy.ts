import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Options } from '../types/index.js';
import { RAW_CARD_TOOLS } from '../config/rawCardTools.js';
import { describeEnvironment, VERIFY_HINT } from '../verify/environment.js';

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
 * Returns the names of the tools that stay registered.
 */
export function applyToolPolicy(server: McpServer, options: Options): string[] {
  const wanted = new Set((options.tools ?? ['all']).map((tool) => tool.trim()));
  const keepAll = wanted.has('all');

  for (const [name, tool] of Object.entries(registeredTools(server))) {
    const cardBlocked = RAW_CARD_TOOLS.has(name) && options.rawCardTools !== true;
    if (cardBlocked || (!keepAll && !wanted.has(name))) {
      tool.remove();
    }
  }

  const environment = describeEnvironment();
  for (const [name, tool] of Object.entries(registeredTools(server))) {
    if (GIVES_VALUE_SIGNAL.test(name) && tool.description && !tool.description.includes('verify_payment')) {
      tool.description = `${tool.description} ${VERIFY_HINT}`;
    }
    // Every result says which environment it came from.
    const handler = tool.handler as (...args: unknown[]) => Promise<{ content?: unknown[] }>;
    (tool as { handler: unknown }).handler = async (...args: unknown[]) => {
      const out = await handler(...args);
      if (out && Array.isArray(out.content)) {
        out.content.push({ type: 'text', text: JSON.stringify({ flutterwave_environment: environment }) });
      }
      return out;
    };
  }

  return Object.keys(registeredTools(server));
}
