#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import server, { startServer } from "./server.js";
import "./config/index.js";
import { parseArgs } from "./cli.js";

async function main() {
    const options = parseArgs(process.argv.slice(2));
    await startServer();
    const transport = new StdioServerTransport();

    // Handle process termination
    process.on('SIGINT', async () => {
      console.error('Shutting down Flutterwave MCP Server...');
      await server.close();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.error('Shutting down Flutterwave MCP Server...');
      await server.close();
      process.exit(0);
    });

    await server.connect(transport);
    console.error("Flutterwave MCP Server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});

