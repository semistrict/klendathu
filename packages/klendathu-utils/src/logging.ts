/**
 * TRACE logging utility for debugging klendathu internals.
 * Enable with: KLENDATHU_TRACE=1
 * Logs to: ~/.klendathu/trace.log
 */

import { writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TRACE_ENABLED = process.env.KLENDATHU_TRACE === '1' || process.env.KLENDATHU_TRACE === 'true';
const TRACE_DIR = join(homedir(), '.klendathu');
const TRACE_FILE = join(TRACE_DIR, 'trace.log');

// Initialize trace file if tracing is enabled
if (TRACE_ENABLED) {
  try {
    mkdirSync(TRACE_DIR, { recursive: true });
    writeFileSync(TRACE_FILE, `=== TRACE SESSION STARTED ${new Date().toISOString()} ===\n`, { flag: 'a' });
  } catch (err) {
    console.error('Failed to initialize trace log:', err);
  }
}

/**
 * Get the caller's file and line number using Error stack traces.
 */
function getCallerLocation(): string {
  const err = new Error();
  const stack = err.stack?.split('\n') || [];

  // Stack typically looks like:
  // Error
  //     at getCallerLocation (...)
  //     at TRACE (...)
  //     at <actual caller>

  for (let i = 2; i < stack.length; i++) {
    const line = stack[i];
    const match = line.match(/\s+at\s+(?:.*\s+)?\(?(.*):(\d+):(\d+)\)?/);
    if (match) {
      let [, filePath, lineNum] = match;

      // Convert file:// URLs to paths
      if (filePath.startsWith('file://')) {
        filePath = fileURLToPath(filePath);
      }

      // Skip if this is the logging.js file itself
      const fileName = filePath.split('/').pop() || filePath;
      if (fileName === 'logging.js') {
        continue;
      }

      return `${fileName}:${lineNum}`;
    }
  }

  return 'unknown:0';
}

/**
 * TRACE function that accepts template strings.
 * Usage: TRACE`Message with ${variable}`
 *
 * When KLENDATHU_TRACE is set, logs to ~/.klendathu/trace.log with:
 * - Timestamp
 * - PID
 * - File and line number of the call
 * - The formatted message
 */
export function TRACE(strings: TemplateStringsArray, ...values: any[]): void {
  if (!TRACE_ENABLED) {
    return;
  }

  // Interpolate the template string
  let message = '';
  for (let i = 0; i < strings.length; i++) {
    message += strings[i];
    if (i < values.length) {
      const value = values[i];
      // Format the value
      if (value instanceof Error) {
        // Serialize Error objects with message and stack
        message += `${value.message}\n${value.stack || ''}`;
      } else if (typeof value === 'object' && value !== null) {
        try {
          message += JSON.stringify(value);
        } catch {
          message += String(value);
        }
      } else {
        message += String(value);
      }
    }
  }

  const timestamp = new Date().toISOString();
  const pid = process.pid;
  const location = getCallerLocation();

  const logLine = `[${timestamp}] [PID:${pid}] [${location}] ${message}\n`;

  try {
    appendFileSync(TRACE_FILE, logLine);
  } catch (err) {
    // Silently fail - don't disrupt the application
  }
}
