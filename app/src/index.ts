import { createServer } from "./server.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);

const app = createServer();

// Local demo only: listen on this machine, not on every network interface (security review L6).
const HOST = process.env.HOST ?? "127.0.0.1";

app.listen(PORT, HOST, () => {
    console.log(`Flutterwave MCP App → http://${HOST}:${PORT}`);
});
