/**
 * klendathu
 *
 * Runtime debugger library. Import this into your Node.js application to enable
 * Claude-powered debugging when exceptions occur.
 *
 * @example
 * ```ts
 * import { investigate } from 'klendathu';
 *
 * try {
 *   // your code
 * } catch (error) {
 *   await investigate({ error, localVar1, localVar2 });
 * }
 * ```
 */

export { investigate, ContextItem, ContextCallable } from './launcher.js';
export { implement } from './implement.js';
export { createMcpServer } from './server.js';
export type {
  DebugContext,
  ImplementContext,
  ServerOptions,
  LaunchOptions,
  ImplementOptions,
  DebuggerPromise,
  Summary,
  StatusMessage,
  InferSchemaType,
} from './types.js';
export { StatusMessageSchema } from './types.js';
