import express from 'express';
import vm from 'node:vm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import type { DebugContext, ServerOptions } from './types.js';

export interface McpServerInstance {
  url: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * Creates and starts an HTTP MCP server with debugging tools
 */
export async function createMcpServer(
  context: DebugContext,
  options: ServerOptions = {}
): Promise<McpServerInstance> {
  const { port = 0, host = 'localhost' } = options;

  // Create a factory function that returns the server with eval tool
  const getServer = () => {
    const server = new McpServer(
      {
        name: 'klendathu',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Register eval tool
    server.registerTool(
      'eval',
      {
        description:
          'Evaluates a JavaScript function expression with access to the debugging context. ' +
          'The function can be async and has access to: context (object with all context variables) and all Node.js globals. ' +
          'Console output (console.log, console.error, etc.) is captured and returned. ' +
          'Use this to inspect variables or execute any debugging logic.',
        inputSchema: {
          function: z.string().describe('Function expression to evaluate, e.g., "async () => { console.log(context.someVar); return context.someVar; }"'),
        },
      },
      async ({ function: fnCode }) => {
        try {
          // Capture console output
          const consoleLogs: Array<{ level: string; args: any[] }> = [];

          const captureConsole = (level: string) => (...args: any[]) => {
            consoleLogs.push({ level, args });
          };

          const customConsole = {
            log: captureConsole('log'),
            error: captureConsole('error'),
            warn: captureConsole('warn'),
            info: captureConsole('info'),
            debug: captureConsole('debug'),
            trace: captureConsole('trace'),
            dir: captureConsole('dir'),
            table: captureConsole('table'),
          };

          const vmContext = vm.createContext({
            context: context.context,
            globalThis,
            console: customConsole,
          });

          // Wrap the function in an async IIFE and execute it
          // This works without experimental flags
          const wrappedCode = `(async () => { const fn = ${fnCode}; return await fn(); })()`;
          const result = await vm.runInContext(wrappedCode, vmContext);

          // Helper to serialize values, handling errors with stack traces
          const serializeValue = (value: any): any => {
            if (value instanceof Error) {
              return {
                __error: true,
                name: value.name,
                message: value.message,
                stack: value.stack,
              };
            }
            if (typeof value === 'object' && value !== null) {
              if (Array.isArray(value)) {
                return value.map(serializeValue);
              }
              const serialized: any = {};
              for (const [key, val] of Object.entries(value)) {
                serialized[key] = serializeValue(val);
              }
              return serialized;
            }
            return value;
          };

          // Build output with result and console logs
          const output: any = {
            result: serializeValue(result),
          };

          if (consoleLogs.length > 0) {
            output.console = consoleLogs.map((log) => ({
              level: log.level,
              args: log.args.map(serializeValue),
            }));
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(output, null, 2),
              },
            ],
          };
        } catch (error) {
          return {
            content: [
              {
                type: 'text',
                text: `Error during eval: ${error instanceof Error ? error.message : String(error)}\n${
                  error instanceof Error && error.stack ? error.stack : ''
                }`,
              },
            ],
            isError: true,
          };
        }
      }
    );

    return server;
  };

  // Create Express app
  const app = express();
  app.use(express.json());

  // Handle HTTP requests - stateless pattern
  app.post('/mcp', async (req, res) => {
    const server = getServer();
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless
        enableJsonResponse: true, // Return JSON instead of SSE streams
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on('close', () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  // Start Express server
  const httpServer = await new Promise<any>((resolve) => {
    const server = app.listen(port, host, () => {
      resolve(server);
    });
  });

  const address = httpServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to get server address');
  }

  const actualPort = address.port;
  const url = `http://${host}:${actualPort}/mcp`;

  let isClosed = false;

  return {
    url,
    port: actualPort,
    close: async () => {
      if (isClosed) return;
      isClosed = true;
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err: Error | undefined) => {
          if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
          else resolve();
        });
      });
    },
  };
}
