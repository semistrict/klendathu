import { z, type ZodRawShape, type ZodTypeAny } from 'zod';
import type { StatusMessage, Summary } from 'klendathu-utils/types';
import { StatusMessageSchema } from 'klendathu-utils/types';

export type { StatusMessage, Summary };
export { StatusMessageSchema };

/**
 * Infer the output type from a ZodRawShape (same as MCP SDK)
 */
export type InferSchemaType<Schema extends ZodRawShape> = z.objectOutputType<Schema, ZodTypeAny>;

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
 * Context for implementation mode
 */
export interface ImplementContext<Schema extends ZodRawShape = ZodRawShape> {
  /** Context variables to make available in eval */
  context: Record<string, unknown>;
  /** Descriptions for context variables */
  contextDescriptions: Record<string, string>;
  /** When the context was captured */
  timestamp: string;
  /** Process ID where implementation started */
  pid: number;
  /** Zod schema for validating the result */
  schema: Schema;
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
  /** Additional instructions to include in the investigation prompt */
  extraInstructions?: string;
}

/**
 * Options for implementation mode
 */
export interface ImplementOptions extends ServerOptions {
  /** Path to claudedebug CLI executable (default: auto-detect) */
  cliPath?: string;
  /** AbortSignal to cancel the implementation */
  signal?: AbortSignal;
  /** Additional instructions to include in the implementation prompt */
  extraInstructions?: string;
}

/**
 * Promise that resolves to Claude's analysis with streaming status info
 */
export interface DebuggerPromise extends Promise<string> {
  /** Stream of structured status messages as the investigation progresses */
  readonly stderr: AsyncIterable<StatusMessage>;
  /** Promise that resolves to summary statistics when investigation completes */
  readonly summary: Promise<Summary>;
}
