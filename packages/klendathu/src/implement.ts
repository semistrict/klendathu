import type { ImplementOptions } from './types.js';
import { z } from 'zod';
import { extractCallStack, buildContext, runAgent } from './agent-runner.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TRACE } from 'klendathu-utils/logging';
import { startServer } from './server.js';
import { createVmExecutor } from './vm-executor.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Implements functionality using Claude AI with structured output
 *
 * @param prompt - Description of what to implement
 * @param context - Context variables to make available
 * @param schema - Zod schema for the expected result
 * @param options - Optional configuration (signal, server settings)
 * @returns Promise that resolves with the validated result matching the schema
 */
export function implement<Schema extends Record<string, z.ZodTypeAny>>(
  prompt: string,
  context: {
    [key: string]: unknown;
  },
  schema: Schema,
  options: ImplementOptions<z.infer<z.ZodObject<Schema>>> = {}
): Promise<z.infer<z.ZodObject<Schema>>> {
  // Build context from input
  const { contextVars } = buildContext(context);

  // Extract call stack
  const callStack = extractCallStack(undefined, 2);

  const timestamp = new Date().toISOString();
  const pid = process.pid;

  return (async () => {
    // Convert schema to JSON Schema
    const jsonSchema = zodToJsonSchema(z.object(schema));

    // Create UDS socket path for server
    const udsPath = join(tmpdir(), `klendathu-${Date.now()}-${Math.random().toString(36).slice(2)}.sock`);
    TRACE`Starting server on UDS: ${udsPath}`;

    // Get context items for template rendering
    const { contextItems } = buildContext(context);

    // Create VM executor with the expected result type
    type ResultType = z.infer<z.ZodObject<Schema>>;
    TRACE`Raw schema keys: ${JSON.stringify(Object.keys(schema))}`;
    for (const [k, v] of Object.entries(schema)) {
      const val = v as any;
      const isZod = val && typeof val === 'object' && ('_def' in val) && ('safeParse' in val);
      TRACE`  schema['${k}'] = ${typeof v}, isZod: ${isZod}, has _def: ${!!val?._def}, has safeParse: ${!!val?.safeParse}`;
    }
    const schemaObject = z.object(schema);
    TRACE`After z.object - schemaObject type: ${typeof schemaObject}, has _def: ${!!schemaObject._def}`;
    for (const [k, v] of Object.entries(schemaObject._def.shape)) {
      const val = v as any;
      const isZod = val && typeof val === 'object' && ('_def' in val) && ('safeParse' in val);
      TRACE`  shape['${k}'] = ${typeof v}, isZod: ${isZod}, has _def: ${!!val?._def}, has safeParse: ${!!val?.safeParse}`;
    }
    const vmExecutor = createVmExecutor<ResultType>(contextVars, schemaObject);

    // Start server with task context (schema is only for the prompt, not for validation)
    TRACE`Starting server on UDS`;
    const server = await startServer(
      {
        instruction: prompt,
        schema: jsonSchema,
        context: contextVars,
        contextItems,
        callStack,
        timestamp,
        pid,
      },
      vmExecutor,
      udsPath,
      options.signal,
      options.validate
    );
    TRACE`Server started and listening`;

    try {
      // Run the agent - CLI will connect to server via UDS
      TRACE`Starting runAgent`;
      const { exitCode } = await runAgent({
        ...options,
        udsPath,
      });
      TRACE`runAgent completed with exitCode: ${exitCode}`;

      // Failsafe: if process exited with error, reject the completion promise immediately
      if (exitCode !== 0) {
        TRACE`Setting bail error due to exit code ${exitCode}`;
        vmExecutor.setBailError(`CLI process exited with code ${exitCode}`);
      }

      // Await the completion promise (resolves on success, rejects on bail)
      TRACE`Awaiting completion promise`;
      const result = await vmExecutor.getCompletion();
      TRACE`Completion promise resolved`;

      return result;

    } finally {
      // Close the server
      TRACE`Closing server`;
      await server.close();
      TRACE`Server closed`;
    }
  })();
}
