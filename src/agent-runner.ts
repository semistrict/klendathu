import { fileURLToPath } from 'node:url';
import type { StackFrame, ContextItem as ContextItemType } from '@/utils/types.js';
import { TRACE } from '@/utils/logging.js';

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

