import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StatusMessageSchema } from 'klendathu-cli/types';
import type { StatusMessage } from './types.js';
import { ContextItem } from './launcher.js';
import type { StackFrame, ContextItem as ContextItemType } from 'klendathu-cli/types';

export function emitEvent(message: { type: string; [key: string]: any }) {
  console.error(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
}

/**
 * Captures the caller's directory from stack trace
 */
export function captureCallerDir(skipFrames: number = 2): string | undefined {
  const callerStack = new Error().stack || '';
  let callerDir: string | undefined;

  const stackLines = callerStack.split('\n');
  // Skip first N lines (Error message and calling functions)
  for (let i = skipFrames; i < stackLines.length; i++) {
    const line = stackLines[i];
    const match = line.match(/\(([^:)]+):\d+:\d+\)/) || line.match(/at ([^:]+):\d+:\d+/);
    if (match) {
      const filePath = match[1];
      if (!filePath.includes('node_modules') && !filePath.startsWith('node:')) {
        try {
          const actualPath = filePath.startsWith('file://')
            ? fileURLToPath(filePath)
            : filePath;
          callerDir = dirname(actualPath);
          break;
        } catch {
          // Continue to next line
        }
      }
    }
  }

  return callerDir;
}

/**
 * Extracts call stack from an error or current execution point
 */
export function extractCallStack(error?: Error, skipFrames: number = 2): StackFrame[] {
  const stack = error?.stack || new Error().stack || '';
  const stackLines = stack.split('\n');
  const frames: StackFrame[] = [];

  // Skip first N lines (Error message and calling functions)
  for (let i = skipFrames; i < stackLines.length; i++) {
    const line = stackLines[i];
    // Match patterns like:
    // "    at functionName (file:///path/file.ts:10:5)"
    // "    at file:///path/file.ts:10:5"
    const match = line.match(/at\s+(?:(.+?)\s+\()?([^:)]+):(\d+):(\d+)/);
    if (match) {
      const [, functionName, filePath, lineStr, columnStr] = match;
      if (!filePath.includes('node_modules') && !filePath.startsWith('node:')) {
        try {
          const actualPath = filePath.startsWith('file://')
            ? fileURLToPath(filePath)
            : filePath;
          frames.push({
            filePath: actualPath,
            line: parseInt(lineStr, 10),
            column: parseInt(columnStr, 10),
            functionName: functionName?.trim(),
          });
        } catch {
          // Skip invalid paths
        }
      }
    }
  }

  return frames;
}

/**
 * Builds context items and vars from input
 */
export function buildContext(context: {
  [key: string]: unknown | ContextItem;
}): {
  contextVars: Record<string, unknown>;
  contextItems: ContextItemType[];
} {
  const contextEntries = context || {};
  const contextVars: Record<string, unknown> = {};
  const contextItems: ContextItemType[] = [];

  for (const [key, value] of Object.entries(contextEntries)) {
    if (value instanceof ContextItem) {
      contextVars[key] = value.value;

      // Special handling for Error objects
      if (value.value instanceof Error) {
        const error = value.value;
        const type = error.constructor.name;
        const description = value.description
          ? `${value.description}\nMessage: ${error.message}\nStack:\n${error.stack}`
          : `Message: ${error.message}\nStack:\n${error.stack}`;

        contextItems.push({
          name: key,
          type,
          description,
        });
      } else {
        contextItems.push({
          name: key,
          type: typeof value.value,
          description: value.description,
        });
      }
    } else {
      contextVars[key] = value;

      // Special handling for Error objects
      if (value instanceof Error) {
        const type = value.constructor.name;
        const description = `Message: ${value.message}\nStack:\n${value.stack}`;

        contextItems.push({
          name: key,
          type,
          description,
        });
      } else {
        contextItems.push({
          name: key,
          type: typeof value,
        });
      }
    }
  }

  return { contextVars, contextItems };
}

/**
 * Finds the CLI path
 */
export function findCliPath(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const cliPath = resolve(currentFile, '../../../klendathu-cli/dist/cli.js');
  return cliPath;
}

/**
 * Runs the agent CLI with structured input
 */
export async function runAgent(params: {
  mode: 'investigate' | 'implement';
  mcpUrl: string;
  callStack: StackFrame[];
  context: ContextItemType[];
  timestamp: string;
  pid: number;
  extraInstructions?: string;
  prompt?: string;
  schema?: Record<string, unknown>;
  cliPath?: string;
  signal?: AbortSignal;
  onStderr?: (message: StatusMessage) => void;
}): Promise<{ exitCode: number | null; stdout: string }> {
  const { mode, mcpUrl, callStack, context, timestamp, pid, extraInstructions, prompt, schema, cliPath, signal, onStderr } = params;

  const resolvedCliPath = cliPath || findCliPath();

  emitEvent({ type: 'log', message: `Launching ${mode}: node ${resolvedCliPath}` });

  // Spawn the CLI with Node.js
  const child = spawn('node', [resolvedCliPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  // Build structured input based on mode
  const input: any = {
    mode,
    mcpUrl,
    callStack,
    context,
    timestamp,
    pid,
    extraInstructions,
  };

  if (mode === 'implement') {
    input.prompt = prompt;
    input.schema = schema;
  }

  // Send structured data as JSON to stdin
  const stdinData = JSON.stringify(input);
  child.stdin?.write(stdinData);
  child.stdin?.end();

  let stdout = '';
  let stderrBuffer = '';

  // Capture stdout
  child.stdout?.on('data', (data) => {
    stdout += data.toString();
  });

  // Parse stderr line-by-line as JSON messages
  child.stderr?.on('data', (data) => {
    stderrBuffer += data.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);
        const message = StatusMessageSchema.parse(parsed);
        onStderr?.(message);
      } catch (err) {
        // Ignore malformed JSON lines
        console.warn('Failed to parse stderr line:', line, err);
      }
    }
  });

  // Handle abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      child.kill('SIGTERM');
    });
  }

  // Wait for process to close
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => resolve(code));
  });

  return { exitCode, stdout };
}
