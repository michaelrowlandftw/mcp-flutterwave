import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/index.js";
import { getApiVersion } from "./config/apiVersion.js";
import { applyToolPolicy } from "./tools/policy.js";
import type { Options } from "./types/index.js";

// Create server instance.
export const server = new McpServer({
    name: "flutterwave",
    version: "1.4.1",
});

// One API version per process (v4 by default). v3 tools and prompts load only in v3 mode.
export async function startServer(options: Options = {}) {
    await registerTools();
    const active = applyToolPolicy(server, options);
    console.error(`Flutterwave MCP Server: ${active.length} tools registered`);
    if (getApiVersion() === 'v3') {
        const { registerPrompts } = await import("./prompts/index.js");
        registerPrompts();
    }
}

export default server;
