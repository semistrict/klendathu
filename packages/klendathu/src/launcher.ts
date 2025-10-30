import type { DebugContext, DebuggerPromise, StatusMessage, Summary } from './types.js';
import { createMcpServer } from './server.js';
import { extractCallStack, buildContext, emitEvent, runAgent } from './agent-runner.js';
import { TRACE } from 'klendathu-utils/logging';

export class ContextItem {
  constructor(public value: unknown, public description?: string) {}
}

export class ContextCallable extends ContextItem {
  constructor(
    public func: (...args: unknown[]) => unknown,
    description?: string
  ) {
    super(func, description);
  }
}

interface InvestigateOptions {
  extraInstructions?: string;
  signal?: AbortSignal;
  cliPath?: string;
  port?: number;
  host?: string;
}

/**
 * Investigates an error using Claude AI
 *
 * @param context - Context variables to make available (error, variables, etc.)
 * @param options - Optional configuration (signal, server settings)
 * @returns Promise that resolves with Claude's analysis, with streaming stderr, cost, and turns available
 */
export function investigate(
  context: {
    [key: string]: unknown | ContextItem;
  },
  options: InvestigateOptions = {}
): DebuggerPromise {
  TRACE`investigate() called`;
  // Build context from input
  const { contextVars, contextItems } = buildContext(context);

  // Extract call stack - pass the error if it exists in context
  const error = contextVars.error instanceof Error ? contextVars.error : undefined;
  const callStack = extractCallStack(error, 2);
  TRACE`Extracted call stack with ${callStack.length} frames`;

  const timestamp = new Date().toISOString();
  const pid = process.pid;

  const debugContext: DebugContext = {
    context: contextVars,
    contextDescriptions: {},
    timestamp,
    pid,
  };

  const stderrMessages: StatusMessage[] = [];
  let summaryResolve: ((summary: Summary) => void) | undefined;
  let summaryReject: ((error: Error) => void) | undefined;

  const summaryPromise = new Promise<Summary>((resolve, reject) => {
    summaryResolve = resolve;
    summaryReject = reject;
  });

  const mainPromise = (async () => {
    // Start MCP server
    TRACE`Creating MCP server`;
    const mcpServer = await createMcpServer(debugContext, options);
    TRACE`MCP server started at ${mcpServer.url}`;

    emitEvent({ type: 'server_started', url: mcpServer.url });

    // Run the agent with structured data
    TRACE`Running agent`;
    const { exitCode, stdout } = await runAgent({
      mode: 'investigate',
      mcpUrl: mcpServer.url,
      callStack,
      context: contextItems,
      timestamp,
      pid,
      extraInstructions: options.extraInstructions,
      cliPath: options.cliPath,
      signal: options.signal,
      onStderr: (message) => {
        stderrMessages.push(message);
        if (message.type === 'summary' && summaryResolve) {
          summaryResolve(message);
        }
      },
    });

    TRACE`Agent completed with exit code: ${exitCode}`;
    await mcpServer.close();
    TRACE`MCP server closed`;

    if (exitCode !== 0) {
      const error = new Error(`Debugger exited with code ${exitCode}`);
      summaryReject?.(error);
      throw error;
    }

    TRACE`Investigation complete, returning stdout`;
    return stdout;
  })() as DebuggerPromise;

  // Add stderr async iterator
  Object.defineProperty(mainPromise, 'stderr', {
    get() {
      return (async function* () {
        let index = 0;
        while (true) {
          if (index < stderrMessages.length) {
            yield stderrMessages[index++];
          } else {
            // Wait for completion
            try {
              await mainPromise;
              // Yield any remaining messages
              while (index < stderrMessages.length) {
                yield stderrMessages[index++];
              }
              break;
            } catch {
              // Process ended, yield remaining messages
              while (index < stderrMessages.length) {
                yield stderrMessages[index++];
              }
              break;
            }
          }
          // Small delay to avoid busy-waiting
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      })();
    },
  });

  // Add summary promise
  Object.defineProperty(mainPromise, 'summary', {
    get() {
      return summaryPromise;
    },
  });

  return mainPromise;
}
