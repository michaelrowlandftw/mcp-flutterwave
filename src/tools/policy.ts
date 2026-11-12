import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Options } from '../types/index.js';
import { RAW_CARD_TOOLS } from '../config/rawCardTools.js';

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

  return Object.keys(registeredTools(server));
}
