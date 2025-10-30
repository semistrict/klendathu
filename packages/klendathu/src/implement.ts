import type { ImplementContext, ImplementOptions, InferSchemaType } from './types.js';
import { createMcpServer } from './server.js';
import type { ZodRawShape } from 'zod';
import { extractCallStack, buildContext, emitEvent, runAgent } from './agent-runner.js';

/**
 * Implements functionality using Claude AI with structured output
 *
 * @param prompt - Description of what to implement
 * @param context - Context variables to make available
 * @param schema - Zod schema for the expected result
 * @param options - Optional configuration (signal, server settings)
 * @returns Promise that resolves with the validated result matching the schema
 */
export function implement<Schema extends ZodRawShape>(
  prompt: string,
  context: {
    [key: string]: unknown;
  },
  schema: Schema,
  options: ImplementOptions = {}
): Promise<InferSchemaType<Schema>> {
  // Build context from input
  const { contextVars, contextItems } = buildContext(context);

  // Extract call stack
  const callStack = extractCallStack(undefined, 2);

  const timestamp = new Date().toISOString();
  const pid = process.pid;

  const implementContext: ImplementContext<Schema> = {
    context: contextVars,
    contextDescriptions: {},
    timestamp,
    pid,
    schema,
  };

  return (async () => {
    // Start MCP server with schema
    const mcpServer = await createMcpServer(implementContext, options);

    emitEvent({ type: 'server_started', url: mcpServer.url });

    // Serialize schema to JSON
    const schemaJson = Object.fromEntries(
      Object.entries(schema).map(([key, zodType]) => [key, { _type: zodType._def.typeName }])
    );

    // Run the agent with structured data
    const { exitCode } = await runAgent({
      mode: 'implement',
      mcpUrl: mcpServer.url,
      callStack,
      context: contextItems,
      timestamp,
      pid,
      prompt,
      schema: schemaJson,
      extraInstructions: options.extraInstructions,
      cliPath: options.cliPath,
      signal: options.signal,
    });

    await mcpServer.close();

    if (exitCode !== 0) {
      throw new Error(`Implementation failed with exit code ${exitCode}`);
    }

    // Get the result from the server
    if (!mcpServer.getResult) {
      throw new Error('Server does not support getResult (not in implement mode)');
    }

    try {
      const result = mcpServer.getResult();
      return result as InferSchemaType<Schema>;
    } catch (error) {
      throw new Error(
        `Agent did not call set_result tool. ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })();
}
