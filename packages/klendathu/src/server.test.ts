import { describe, it, expect, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createMcpServer } from './server.js';
import type { DebugContext } from './types.js';

describe('MCP Server', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];
  const clients: Array<Client> = [];
  const transports: Array<StreamableHTTPClientTransport> = [];

  afterEach(async () => {
    for (const transport of transports) {
      await transport.close().catch(() => {});
    }
    for (const server of servers) {
      await server.close();
    }
    servers.length = 0;
    clients.length = 0;
    transports.length = 0;
  });

  async function setupMcpClient(context: DebugContext) {
    const server = await createMcpServer(context);
    servers.push(server);

    const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
    clients.push(client);

    const transport = new StreamableHTTPClientTransport(new URL(server.url));
    transports.push(transport);

    await client.connect(transport);

    return { server, client, transport };
  }

  it('should start server on random port when port is 0', async () => {
    const context: DebugContext = {
      context: { test: 'value' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    const server = await createMcpServer(context, { port: 0 });
    servers.push(server);

    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toContain('http://localhost:');
    expect(server.url).toContain('/mcp');
  });

  it('should start server on specified host', async () => {
    const context: DebugContext = {
      context: { test: 'value' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    const server = await createMcpServer(context, { port: 0, host: 'localhost' });
    servers.push(server);

    expect(server.url).toBe(`http://localhost:${server.port}/mcp`);
  });

  it('should close server without error', async () => {
    const context: DebugContext = {
      context: { test: 'value' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    const server = await createMcpServer(context);

    await expect(server.close()).resolves.toBeUndefined();
  });

  it('should handle double close gracefully', async () => {
    const context: DebugContext = {
      context: { test: 'value' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    };

    const server = await createMcpServer(context);

    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('should list eval tool via MCP client', async () => {
    const { client } = await setupMcpClient({
      context: { foo: 'bar' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });

    const result = await client.listTools();

    expect(result.tools).toBeDefined();
    expect(result.tools.length).toBeGreaterThan(0);

    const evalTool = result.tools.find((t) => t.name === 'eval');
    expect(evalTool).toBeDefined();
    expect(evalTool!.name).toBe('eval');
    expect(evalTool!.description).toContain('context');
  });

  it('should call eval tool and return result', async () => {
    const { client } = await setupMcpClient({
      context: { foo: 'bar', num: 42 },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });

    const result = await client.callTool({
      name: 'eval',
      arguments: {
        function: 'async () => { return context.foo; }',
      },
    });

    expect(result.content).toBeDefined();
    expect((result.content as any[]).length).toBeGreaterThan(0);
    expect((result.content as any[])[0].type).toBe('text');

    const output = JSON.parse((result.content as any[])[0].text);
    expect(output.result).toBe('bar');
  });

  it('should capture console.log in eval', async () => {
    const { client } = await setupMcpClient({
      context: { foo: 'bar' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });

    const result = await client.callTool({
      name: 'eval',
      arguments: {
        function: 'async () => { console.log("test", 123); return "done"; }',
      },
    });

    const output = JSON.parse((result.content as any[])[0].text);

    expect(output.console).toBeDefined();
    expect(output.console.length).toBe(1);
    expect(output.console[0].level).toBe('log');
    expect(output.console[0].args).toEqual(['test', 123]);
    expect(output.result).toBe('done');
  });

  it('should serialize errors with stack traces', async () => {
    const testError = new Error('Test error');
    const { client } = await setupMcpClient({
      context: { error: testError },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });

    const result = await client.callTool({
      name: 'eval',
      arguments: {
        function: 'async () => { return context.error; }',
      },
    });

    const output = JSON.parse((result.content as any[])[0].text);

    expect(output.result.__error).toBe(true);
    expect(output.result.name).toBe('Error');
    expect(output.result.message).toBe('Test error');
    expect(output.result.stack).toBeDefined();
    expect(output.result.stack).toContain('Test error');
  });

  it('should handle eval errors gracefully', async () => {
    const { client } = await setupMcpClient({
      context: { foo: 'bar' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
    });

    const result = await client.callTool({
      name: 'eval',
      arguments: {
        function: 'async () => { throw new Error("Eval error"); }',
      },
    });

    expect(result.isError).toBe(true);
    expect(((result.content as any[])[0] as any).text).toContain('Error during eval');
    expect(((result.content as any[])[0] as any).text).toContain('Eval error');
  });

  it('should have fail_implementation tool in implement mode', async () => {
    const context: any = {
      context: { test: 'value' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
      schema: { result: { _type: 'ZodString' } },
    };

    const { client } = await setupMcpClient(context);

    const result = await client.listTools();

    const failTool = result.tools.find((t) => t.name === 'fail_implementation');
    expect(failTool).toBeDefined();
    expect(failTool!.name).toBe('fail_implementation');
    expect(failTool!.description).toContain('cannot fulfill');
  });

  it('should call fail_implementation tool and record failure', async () => {
    const context: any = {
      context: { test: 'value' },
      contextDescriptions: {},
      timestamp: new Date().toISOString(),
      pid: process.pid,
      schema: { result: { _type: 'ZodString' } },
    };

    const { server, client } = await setupMcpClient(context);

    const result = await client.callTool({
      name: 'fail_implementation',
      arguments: {
        reason: 'Cannot generate data without required fields',
      },
    });

    expect(result.content).toBeDefined();
    expect(((result.content as any[])[0] as any).text).toContain('Implementation failure recorded');

    // Verify getResult throws the failure reason
    expect(() => server.getResult?.()).toThrow('Implementation failed: Cannot generate data without required fields');
  });
});
