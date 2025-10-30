import express from 'express';
import vm from 'node:vm';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z, type ZodRawShape } from 'zod';
import type { DebugContext, ServerOptions, ImplementContext } from './types.js';

export interface McpServerInstance {
  url: string;
  port: number;
  close: () => Promise<void>;
  getResult?: () => unknown;
}

/**
 * Creates and starts an HTTP MCP server with debugging tools
 */
export async function createMcpServer<Schema extends ZodRawShape = ZodRawShape>(
  context: DebugContext | ImplementContext<Schema>,
  options: ServerOptions = {}
): Promise<McpServerInstance> {
  const { port = 0, host = 'localhost' } = options;

  // Shared state for set_result tool
  let resultValue: unknown = undefined;
  let resultWasSet = false;

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

    // Register set_result tool if we're in implement mode
    if ('schema' in context && context.schema) {
      server.registerTool(
        'set_result',
        {
          description:
            'Sets the final result of the implementation by evaluating a function. This tool MUST be called with your completed implementation before finishing. ' +
            'The function should accept the context object as a parameter and return the implementation result. ' +
            'The returned value will be validated against the expected schema.',
          inputSchema: {
            function: z.string().describe('Function expression that takes context as parameter and returns the result, e.g., "(context) => ({ result: \'value\' })"'),
          },
        },
        async ({ function: fnCode }) => {
          try {
            // Execute the function with context (similar to eval)
            const vmContext = vm.createContext({
              context: context.context,
              globalThis,
            });

            const wrappedCode = `(async () => { const fn = ${fnCode}; return await fn(context); })()`;
            const result = await vm.runInContext(wrappedCode, vmContext);

            // Validate result against schema
            const schemaObject = z.object(context.schema);
            const validated = schemaObject.parse(result);
            resultValue = validated;
            resultWasSet = true;

            return {
              content: [
                {
                  type: 'text',
                  text: 'Result set successfully and validated against schema.',
                },
              ],
            };
          } catch (error) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error: ${error instanceof Error ? error.message : String(error)}\n\n${
                    error instanceof Error && error.stack ? error.stack : ''
                  }\n\nPlease fix the errors and call set_result again with a valid function.`,
                },
              ],
              isError: true,
            };
          }
        }
      );
    }

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

  const instance: McpServerInstance = {
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

  // Add getResult if in implement mode
  if ('schema' in context && context.schema) {
    instance.getResult = () => {
      if (!resultWasSet) {
        throw new Error('Result was not set by agent');
      }
      return resultValue;
    };
  }

  return instance;
}
