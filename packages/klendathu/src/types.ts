import { z, type ZodTypeAny } from 'zod';
import type { StatusMessage, Summary } from 'klendathu-utils/types';
import { StatusMessageSchema } from 'klendathu-utils/types';

export type { StatusMessage, Summary };
export { StatusMessageSchema };

/**
 * Infer the output type from a Zod schema
 */
export type InferSchemaType<T extends z.ZodTypeAny> = z.infer<T>;

/**
 * Context for implementation mode
 */
export interface ImplementContext<Schema extends Record<string, ZodTypeAny> = Record<string, ZodTypeAny>> {
  /** Context variables to make available to the implementation */
  context: Record<string, unknown>;
  /** Zod schema for validating the result */
  schema: Schema;
}

/**
 * Options for implementation mode
 */
export interface ImplementOptions<Result = unknown> {
  /** Path to CLI executable (default: auto-detect) */
  cliPath?: string;
  /** AbortSignal to cancel the implementation */
  signal?: AbortSignal;
  /** If true, require cache hit and fail if cache cannot be used */
  forceUseCache?: boolean;
  /** Optional validation function that can throw an error to reject the result */
  validate?: (result: Result) => void | Promise<void>;
}
