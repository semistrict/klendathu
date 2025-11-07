/**
 * klendathu
 *
 * AI-powered code implementation library. Use Claude to implement functionality based on prompts.
 *
 * @example
 * ```ts
 * import { implement } from 'klendathu';
 *
 * const result = await implement(
 *   'Sort an array in descending order',
 *   { data: [3, 1, 4, 1, 5] },
 *   { sorted: z.array(z.number()) }
 * );
 * ```
 */

export { implement } from './implement.js';
export type {
  ImplementContext,
  ImplementOptions,
  InferSchemaType,
} from './types.js';
