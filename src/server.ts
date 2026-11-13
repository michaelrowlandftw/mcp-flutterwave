import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools/index.js";
import { getApiVersion } from "./config/apiVersion.js";
import { applyToolPolicy } from "./tools/policy.js";
import type { Options } from "./types/index.js";
import { SERVER_VERSION } from "./config/userAgent.js";
import { registerDocsGuide, SERVER_INSTRUCTIONS } from "./resources/docsGuide.js";

// Create server instance.
export const server = new McpServer(
    {
        name: "flutterwave",
        version: SERVER_VERSION,
    },
    { instructions: SERVER_INSTRUCTIONS },
);

// One API version per process (v4 by default). v3 tools and prompts load only in v3 mode.
export async function startServer(options: Options = {}) {
    await registerTools();
    const active = applyToolPolicy(server, options);
    console.error(`Flutterwave MCP Server: ${active.length} tools registered`);
    registerDocsGuide(server);
    if (getApiVersion() === 'v3') {
        const { registerPrompts } = await import("./prompts/index.js");
        registerPrompts();
    }
}

export default server;
