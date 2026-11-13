import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const DOCS_GUIDE_URI = 'flutterwave://docs/guide';

/**
 * Where the AI should look for integration help. Checked 12 Nov 2026.
 * Kept as links, not copied text, so it stays current with the docs.
 */
export const DOCS_GUIDE = `# Flutterwave developer docs guide

Use this when someone asks how to integrate Flutterwave, wants sample code, or asks about webhooks, testing or errors. Read the docs before you answer. Don't guess field names or flows.

## Documentation index

- Docs index for AI tools: https://developer.flutterwave.com/llms.txt
- All docs pages in one Markdown file: https://developer.flutterwave.com/llms-full.txt
- OpenAPI specification: https://developer.flutterwave.com/api/v3/openapi.json

Fetch llms.txt first and follow the link for the topic. v4 pages sit under /v4/docs and /v4/api.

## Pages to read for common questions

- Testing and test data: https://developer.flutterwave.com/v4/docs/testing
- Webhooks and signature checks: https://developer.flutterwave.com/v4/docs/webhooks
- Idempotency (avoid duplicate charges and transfers): https://developer.flutterwave.com/v4/docs/idempotency
- Request headers: https://developer.flutterwave.com/v4/docs/api-headers
- Libraries and plugins: https://developer.flutterwave.com/docs/directory

## Code samples (official SDKs)

- Node.js: https://github.com/Flutterwave/Node-v3
- PHP: https://github.com/Flutterwave/PHP-v3
- Python: https://github.com/Flutterwave/Python-v2
- React: https://github.com/Flutterwave/React-v3
- Other languages and plugins: https://github.com/Flutterwave

## Webhooks

- Use the default dashboard webhook settings, with every preference ticked. On v3, "Enable v3 webhooks" must be on; with it off, Flutterwave sends an older flat format.
- Two settings may not be available: "payout subaccounts wallet funding hook" needs admin approval, and "service health insight" could not be enabled in testing.
- Check the signature on every webhook: v3 sends the secret hash in \`verif-hash\`; v4 sends a base64 HMAC-SHA256 of the raw body in \`flutterwave-signature\`.
- A webhook is a signal to check, not proof: fetch the record from the API before giving value (the verify_webhook tool does this). Webhooks can arrive about 10 minutes late.

## Rules for sample code

- Use test keys and the sandbox in examples. Never put a secret key in browser or mobile code.
- Use hosted checkout for card payments, so card data never touches the merchant's server.
- Give every create request a unique reference. Before you retry a failed create, look it up by that reference.
- Verify a payment on the server (status, amount, currency and reference) before giving value. A webhook or a redirect is a signal to check, not proof of payment.
`;

export const SERVER_INSTRUCTIONS = `Flutterwave MCP server. Use the tools to call the Flutterwave API.
For integration guides, code samples and webhook help, read the resource ${DOCS_GUIDE_URI} or https://developer.flutterwave.com/llms.txt.`;

export function registerDocsGuide(server: McpServer): void {
  server.resource(
    'flutterwave_docs_guide',
    DOCS_GUIDE_URI,
    {
      description:
        'Where to find Flutterwave docs, the llms.txt index, the OpenAPI spec and official code samples.',
      mimeType: 'text/markdown',
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: 'text/markdown', text: DOCS_GUIDE }],
    }),
  );

  server.prompt(
    'flutterwave_integration_help',
    'Answer an integration question using the Flutterwave docs and official code samples.',
    async () => ({
      messages: [{ role: 'user', content: { type: 'text', text: DOCS_GUIDE } }],
    }),
  );
}
