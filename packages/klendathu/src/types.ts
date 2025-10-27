import { z } from 'zod';

/**
 * Context captured for debugging
 */
export interface DebugContext {
  /** Context variables to make available in eval */
  context: Record<string, unknown>;
  /** Descriptions for context variables */
  contextDescriptions: Record<string, string>;
  /** When the context was captured */
  timestamp: string;
  /** Process ID where error occurred */
  pid: number;
}

/**
 * Options for the MCP server
 */
export interface ServerOptions {
  /** Port to run the HTTP server on (default: random) */
  port?: number;
  /** Host to bind to (default: 'localhost') */
  host?: string;
}

/**
 * Options for launching the debugger
 */
export interface LaunchOptions extends ServerOptions {
  /** Path to claudedebug CLI executable (default: auto-detect) */
  cliPath?: string;
  /** AbortSignal to cancel the debugger investigation */
  signal?: AbortSignal;
}

/**
 * Stderr protocol messages - all stderr output is JSON parseable
 */
export const StderrMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('log'),
    message: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('server_started'),
    url: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('turn'),
    turnNumber: z.number(),
    stopReason: z.string().optional(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('tool_call'),
    toolName: z.string(),
    input: z.record(z.unknown()),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolName: z.string(),
    resultPreview: z.string(),
    timestamp: z.string(),
  }),
  z.object({
    type: z.literal('summary'),
    cost: z.number(),
    turns: z.number(),
    timestamp: z.string(),
  }),
]);

export type StderrMessage = z.infer<typeof StderrMessageSchema>;
export type Summary = Extract<StderrMessage, { type: 'summary' }>;

/**
 * Promise that resolves to Claude's analysis with streaming debug info
 */
export interface DebuggerPromise extends Promise<string> {
  /** Stream of structured stderr messages as the investigation progresses */
  readonly stderr: AsyncIterable<StderrMessage>;
  /** Promise that resolves to summary statistics when investigation completes */
  readonly summary: Promise<Summary>;
}
