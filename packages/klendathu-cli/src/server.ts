import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { TRACE } from 'klendathu-utils/logging';
import type { UdsHttpClient } from './uds-client.js';

export const ToolResultSchema = z.discriminatedUnion('error', [
  z.object({
    error: z.literal(false),
    data: z.unknown(),
  }),
  z.object({
    error: z.literal(true),
    message: z.string(),
    stack: z.string().optional(),
  }),
]);

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * Creates in-process MCP server that delegates to HTTP backend
 */
export function createMcpServerWithHttpBackend(
  httpClient: UdsHttpClient,
  options?: { onSetResult?: (result: unknown) => void; abort?: () => void; onToolCall?: (tool: string, code: string, result: unknown) => void }
) {
  // Create eval tool that delegates to HTTP
  const evalTool = tool(
    'eval',
    'Evaluates a JavaScript function expression',
    {
      code: z.string().describe('Function expression to evaluate'),
    },
    async ({ code }) => {
      TRACE`MCP eval tool called with code length: ${code.length}`;
      try {
        const response = await httpClient.post<{
          error?: boolean;
          message?: string;
          stack?: string;
          result?: unknown;
          console?: Array<{ level: string; args: unknown[] }>;
        }>('/eval', { code });
        const data = response.data as any;

        // Build ToolResult
        let toolResult: ToolResult;
        if (data.error) {
          toolResult = {
            error: true,
            message: data.message || 'Unknown error',
            stack: data.stack,
          };
        } else {
          toolResult = {
            error: false,
            data,
          };
        }

        if (options?.onToolCall) {
          options.onToolCall('eval', code, toolResult);
        }

        // Check for error in response body
        if (data.error) {
          const errorText = `${data.message}${data.stack ? '\n' + data.stack : ''}`;
          TRACE`eval error response: ${errorText}`;
          return {
            content: [
              {
                type: 'text' as const,
                text: errorText,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        TRACE`eval network error: ${errorText}`;
        console.error(`Network error calling eval: ${errorText}`);
        process.exit(1);
      }
    }
  );

  // Create set_result tool that delegates to HTTP
  const setResultTool = tool(
    'set_result',
    'Execute code to produce final result',
    {
      code: z.string().describe('Code that produces the result'),
    },
    async ({ code }) => {
      TRACE`MCP set_result tool called with code length: ${code.length}`;
      try {
        const response = await httpClient.post<{
          error?: boolean;
          message?: string;
          stack?: string;
          result?: unknown;
        }>('/complete', { code });
        const data = response.data as any;

        // Build ToolResult
        let toolResult: ToolResult;
        if (data.error) {
          toolResult = {
            error: true,
            message: data.message || 'Unknown error',
            stack: data.stack,
          };
        } else {
          toolResult = {
            error: false,
            data: data.result,
          };
        }

        if (options?.onToolCall) {
          options.onToolCall('set_result', code, toolResult);
        }

        // Check for error in response body
        if (data.error) {
          const errorText = `${data.message}${data.stack ? '\n' + data.stack : ''}`;
          TRACE`set_result error response: ${errorText}`;
          return {
            content: [
              {
                type: 'text' as const,
                text: errorText,
              },
            ],
            isError: true,
          };
        }

        // Store result and abort query
        const resultValue = data.result;
        TRACE`set_result computed: ${JSON.stringify(resultValue)}`;
        if (options?.onSetResult) {
          options.onSetResult(resultValue);
        }
        if (options?.abort) {
          options.abort();
        }
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Result computed',
            },
          ],
        };
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        TRACE`set_result network error: ${errorText}`;
        console.error(`Network error calling set_result: ${errorText}`);
        process.exit(1);
      }
    }
  );

  // Create bail tool to fail with a custom error message
  const bailTool = tool(
    'bail',
    'Fail the implementation with an error message',
    {
      message: z.string().describe('Error message explaining why the task cannot be completed'),
    },
    async ({ message }) => {
      TRACE`MCP bail tool called with message: ${message}`;
      try {
        await httpClient.post('/complete', {
          failure: true,
          message,
        });
        TRACE`bail sent to /complete`;
        return {
          content: [
            {
              type: 'text' as const,
              text: `Implementation failed: ${message}`,
            },
          ],
          isError: true,
        };
      } catch (error) {
        const errorText = error instanceof Error ? error.message : String(error);
        TRACE`bail network error: ${errorText}`;
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to send bail message: ${errorText}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  return createSdkMcpServer({
    name: 'klendathu',
    version: '0.1.0',
    tools: [evalTool, setResultTool, bailTool],
  });
}
