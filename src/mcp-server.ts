import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { TRACE } from '@/utils/logging.js';
import type { VmExecutor } from './vm-executor.js';
import { ToolResultSchema } from './transcript.js';

export type ToolResult = z.infer<typeof ToolResultSchema>;

/**
 * Creates in-process MCP server that calls VM executor directly (no HTTP delegation)
 */
export function createMcpServer(
  vmExecutor: VmExecutor,
  options?: { onSetResult?: (result: unknown) => void; abort?: () => void; onToolCall?: (tool: string, code: string, result: unknown) => void }
) {
  // Create eval tool that calls vmExecutor directly
  const evalTool = tool(
    'eval',
    'Evaluates a JavaScript function expression',
    {
      code: z.string().describe('Function expression to evaluate'),
    },
    async ({ code }) => {
      TRACE`MCP eval tool called with code length: ${code.length}`;
      try {
        const response = await vmExecutor.eval(code);
        const data = response as any;

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
        TRACE`eval error: ${errorText}`;
        console.error(`Error in eval: ${errorText}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${errorText}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // Create set_result tool that calls vmExecutor directly
  const setResultTool = tool(
    'set_result',
    'Execute code to produce final result',
    {
      code: z.string().describe('Code that produces the result'),
    },
    async ({ code }) => {
      TRACE`MCP set_result tool called with code length: ${code.length}`;
      try {
        const result = await vmExecutor.setResult(code);

        // Build ToolResult
        const toolResult: ToolResult = {
          error: false,
          data: result,
        };

        if (options?.onToolCall) {
          options.onToolCall('set_result', code, toolResult);
        }

        // Store result and abort query
        TRACE`set_result computed: ${JSON.stringify(result)}`;
        if (options?.onSetResult) {
          options.onSetResult(result);
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
        TRACE`set_result error: ${errorText}`;
        console.error(`Error in set_result: ${errorText}`);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${errorText}`,
            },
          ],
          isError: true,
        };
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
      vmExecutor.setBailError(message);
      TRACE`bail sent`;
      return {
        content: [
          {
            type: 'text' as const,
            text: `Implementation failed: ${message}`,
          },
        ],
        isError: true,
      };
    }
  );

  return createSdkMcpServer({
    name: 'klendathu',
    version: '0.1.0',
    tools: [evalTool, setResultTool, bailTool],
  });
}
