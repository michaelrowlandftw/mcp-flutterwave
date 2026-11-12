import type { McpServer, RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Options } from '../types/index.js';

/** The SDK keeps registered tools in a private map keyed by name. */
export function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })
    ._registeredTools;
}

/**
 * Apply start-up options to the tools already registered.
 * --tools: keep only the tools listed ("all" keeps every tool).
 * Returns the names of the tools that stay registered.
 */
export function applyToolPolicy(server: McpServer, options: Options): string[] {
  const wanted = new Set((options.tools ?? ['all']).map((tool) => tool.trim()));
  const keepAll = wanted.has('all');

  for (const [name, tool] of Object.entries(registeredTools(server))) {
    if (!keepAll && !wanted.has(name)) {
      tool.remove();
    }
  }

  return Object.keys(registeredTools(server));
}
