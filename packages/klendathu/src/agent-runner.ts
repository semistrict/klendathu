import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StackFrame, ContextItem as ContextItemType } from 'klendathu-utils/types';
import { TRACE } from 'klendathu-utils/logging';

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
  [key: string]: unknown;
}): {
  contextVars: Record<string, unknown>;
  contextItems: ContextItemType[];
} {
  const contextEntries = context || {};
  const contextVars: Record<string, unknown> = {};
  const contextItems: ContextItemType[] = [];

  for (const [key, value] of Object.entries(contextEntries)) {
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
      const type = typeof value;
      let description: string | undefined;

      // Extract methods from objects
      if (type === 'object' && value !== null) {
        try {
          const methods: string[] = [];
          const obj = value as Record<string, unknown>;

          // Get all properties and methods
          for (const prop in obj) {
            if (typeof obj[prop] === 'function' && !prop.startsWith('__')) {
              methods.push(prop);
            }
          }

          // Also check prototype chain for common methods
          const proto = Object.getPrototypeOf(obj);
          if (proto) {
            for (const prop of Object.getOwnPropertyNames(proto)) {
              if (typeof proto[prop] === 'function' && !prop.startsWith('__') && !methods.includes(prop)) {
                methods.push(prop);
              }
            }
          }

          if (methods.length > 0) {
            description = `Available methods: ${methods.join(', ')}`;
          }
        } catch {
          // Silently ignore if we can't extract methods
        }
      }

      contextItems.push({
        name: key,
        type,
        description,
      });
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
  cliPath?: string;
  signal?: AbortSignal;
  udsPath?: string;
  forceUseCache?: boolean;
}): Promise<{ exitCode: number | null }> {
  TRACE`runAgent() called`;

  const resolvedCliPath = params.cliPath || findCliPath();
  TRACE`Resolved CLI path: ${resolvedCliPath}`;

  // Build CLI arguments
  const cliArgs = [resolvedCliPath];
  if (params.udsPath) {
    cliArgs.push(params.udsPath);
  }

  // Build environment variables
  const env = { ...process.env };
  if (params.forceUseCache) {
    env.KLENDATHU_CACHE_MODE = 'force-use';
    TRACE`Setting KLENDATHU_CACHE_MODE=force-use`;
  }

  // Spawn the CLI with Node.js
  TRACE`Spawning child process: node ${cliArgs.join(' ')}`;
  const child = spawn('node', cliArgs, {
    stdio: ['ignore', 'inherit', 'inherit'],
    env,
  });
  TRACE`Child process spawned with PID: ${child.pid}`;

  // Handle abort signal
  if (params.signal) {
    params.signal.addEventListener('abort', () => {
      child.kill('SIGTERM');
    });
  }

  // Wait for process to close
  TRACE`Waiting for child process to close`;
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('close', (code) => {
      TRACE`Child process closed with exit code: ${code}`;
      resolve(code);
    });
  });

  TRACE`runAgent() returning with exitCode: ${exitCode}`;
  return { exitCode };
}
