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

export { investigate } from './launcher.js';
export { createMcpServer } from './server.js';
export type { DebugContext, ServerOptions, LaunchOptions, DebuggerPromise, Summary, StderrMessage } from './types.js';
export { StderrMessageSchema } from './types.js';
