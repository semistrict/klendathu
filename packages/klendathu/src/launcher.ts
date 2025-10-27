import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DebugContext, LaunchOptions, DebuggerPromise, StderrMessage, Summary } from './types.js';
import { StderrMessageSchema } from './types.js';
import { createMcpServer } from './server.js';

function emitStderr(message: { type: string; [key: string]: any }) {
  console.error(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
}

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
  // Build context from input
  const contextEntries = context || {};
  const contextVars: Record<string, unknown> = {};
  const contextDescriptions: Record<string, string> = {};

  for (const [key, value] of Object.entries(contextEntries)) {
    if (value instanceof ContextItem) {
      contextVars[key] = value.value;
      if (value.description) {
        contextDescriptions[key] = value.description;
      }
    } else {
      contextVars[key] = value;
    }
  }

  const timestamp = new Date().toISOString();
  const pid = process.pid;

  const debugContext: DebugContext = {
    context: contextVars,
    contextDescriptions,
    timestamp,
    pid,
  };

  const stderrMessages: StderrMessage[] = [];
  let summaryResolve: ((summary: Summary) => void) | undefined;
  let summaryReject: ((error: Error) => void) | undefined;

  const summaryPromise = new Promise<Summary>((resolve, reject) => {
    summaryResolve = resolve;
    summaryReject = reject;
  });

  const mainPromise = (async () => {
    // Start MCP server
    const mcpServer = await createMcpServer(debugContext, options);

    emitStderr({ type: 'server_started', url: mcpServer.url });

    // Find CLI path
    const cliPath = options.cliPath || findCliPath();

    // Build dynamic prompt
    let prompt = `Execution is currently paused at:\n\n`;

    // Add stack trace if error exists
    if (contextVars.error && contextVars.error instanceof Error && contextVars.error.stack) {
      prompt += `${contextVars.error.stack}\n\n`;
    } else {
      prompt += `PID ${pid} at ${timestamp}\n\n`;
    }

    prompt += `Available context variables:\n`;
    for (const [key, value] of Object.entries(contextVars)) {
      const desc = contextDescriptions[key];
      if (desc) {
        prompt += `- ${key}: ${desc}\n`;
      } else {
        prompt += `- ${key}: ${typeof value}\n`;
      }
    }

    prompt += `\nYou have access to an "eval" MCP tool that can execute JavaScript functions with access to the error context.\n\n`;
    prompt += `The eval tool accepts a "function" parameter containing a JavaScript function expression like: "async () => { return someVariable; }"\n\n`;
    prompt += `Available in the eval context:\n`;
    prompt += `- context: Object containing all captured context variables\n`;
    prompt += `- All Node.js globals: console, process, Buffer, Promise, etc.\n\n`;
    prompt += `Your investigation should:\n`;
    prompt += `1. Use eval to inspect context variables as needed\n`;
    prompt += `2. Use console.log() inside eval functions - all console output will be captured and returned to you\n\n`;
    prompt += `After your investigation, provide:\n`;
    prompt += `- A clear description of what happened\n`;
    prompt += `- The root cause based on the context\n`;
    prompt += `- Specific suggestions for how to fix it\n\n`;
    prompt += `Begin your investigation now.`;

    if (options.extraInstructions) {
      prompt += `\n\nAdditional instructions:\n${options.extraInstructions}`;
    }

    emitStderr({ type: 'log', message: `Launching debugger: node ${cliPath} ${mcpServer.url}` });

    // Spawn the CLI with Node.js
    const child = spawn('node', [cliPath, mcpServer.url], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    });

    // Send prompt to stdin
    child.stdin?.write(prompt);
    child.stdin?.end();

    let stdout = '';
    let stderrBuffer = '';

    // Parse stderr line-by-line as JSON messages
    child.stderr?.on('data', (data) => {
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          const message = StderrMessageSchema.parse(parsed);
          stderrMessages.push(message);

          if (message.type === 'summary' && summaryResolve) {
            summaryResolve(message);
          }
        } catch (err) {
          // Ignore malformed JSON lines
          console.warn('Failed to parse stderr line:', line, err);
        }
      }
    });

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    // Handle cleanup
    const cleanup = async () => {
      await mcpServer.close();
    };

    // Handle abort signal
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        child.kill('SIGTERM');
      });
    }

    // Wait for process to close
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code));
    });

    await cleanup();

    if (exitCode !== 0) {
      const error = new Error(`Debugger exited with code ${exitCode}`);
      summaryReject?.(error);
      throw error;
    }

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

/**
 * Attempts to find the claudedebug CLI executable
 */
function findCliPath(): string {
  // TODO(agent): Implement proper CLI path resolution
  // Options to try in order:
  // 1. Global install: 'claudedebug' in PATH
  // 2. Local monorepo: relative path during development
  // 3. Package bin: when installed as dependency

  // For now, assume it's in the monorepo during development
  const currentFile = fileURLToPath(import.meta.url);
  const cliPath = resolve(currentFile, '../../../klendathu-cli/dist/cli.js');

  return cliPath;
}
