import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DOCS_GUIDE_URI, registerDocsGuide } from '../resources/docsGuide.js';

async function connected() {
  const server = new McpServer({ name: 't', version: '0' });
  registerDocsGuide(server);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'c', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

describe('docs guide', () => {
  it('serves a resource that points to llms.txt and code samples', async () => {
    const client = await connected();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(DOCS_GUIDE_URI);
    const { contents } = await client.readResource({ uri: DOCS_GUIDE_URI });
    const text = String((contents[0] as { text?: string } | undefined)?.text);
    expect(text).toContain('https://developer.flutterwave.com/llms.txt');
    expect(text).toContain('https://github.com/Flutterwave/Node-v3');
  });

  it('offers an integration help prompt', async () => {
    const client = await connected();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('flutterwave_integration_help');
    const prompt = await client.getPrompt({ name: 'flutterwave_integration_help' });
    expect(JSON.stringify(prompt.messages)).toContain('llms.txt');
  });
});
