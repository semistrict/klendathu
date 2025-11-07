import type { ImplementOptions } from './types.js';
import { z } from 'zod';
import { query } from '@anthropic-ai/claude-agent-sdk';
import Mustache from 'mustache';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { TRACE } from '@/utils/logging.js';
import { createVmExecutor } from './vm-executor.js';
import { createMcpServer } from './mcp-server.js';
import { Transcript } from './transcript.js';
import { getCacheKey, getCachePath, loadCachedTranscript } from './cache.js';
import { generateCombinedCode } from './transcript-codegen.js';
import { IMPLEMENT_PROMPT_TEMPLATE } from './strings.js';
import { extractCallStack, buildContext } from './agent-runner.js';

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
  const { contextVars, contextItems } = buildContext(context);

  // Extract call stack
  const callStack = extractCallStack(undefined, 2);

  const timestamp = new Date().toISOString();
  const pid = process.pid;

  return (async () => {
    // Convert schema to JSON Schema
    const jsonSchema = zodToJsonSchema(z.object(schema));
    const schemaObject = z.object(schema);
    type ResultType = z.infer<z.ZodObject<Schema>>;

    // Check cache first
    const cacheKey = getCacheKey(prompt, jsonSchema);
    const cachePath = getCachePath(cacheKey);
    const cacheMode = process.env.KLENDATHU_CACHE_MODE || 'normal';
    const shouldIgnoreCache = cacheMode === 'ignore';
    const shouldForceCache = cacheMode === 'force-use';

    TRACE`Cache mode: ${cacheMode}, shouldIgnore: ${shouldIgnoreCache}, shouldForce: ${shouldForceCache}`;

    let cachedTranscript = null;
    if (!shouldIgnoreCache) {
      cachedTranscript = loadCachedTranscript(cachePath);
    }

    if (cachedTranscript) {
      TRACE`Cache hit! Using cached transcript`;
      const vmExecutor = createVmExecutor<ResultType>(contextVars, schemaObject, options.validate);
      const combinedCode = generateCombinedCode(cachedTranscript.calls);
      try {
        return await vmExecutor.setResult(combinedCode);
      } catch (error) {
        TRACE`Cache replay failed, continuing with fresh execution: ${error}`;
      }
    } else if (shouldForceCache) {
      TRACE`Cache required (force-use mode) but not found at ${cachePath}`;
      throw new Error(`Cache required but not found: ${cachePath}`);
    }

    // Create VM executor with the expected result type
    const vmExecutor = createVmExecutor<ResultType>(contextVars, schemaObject, options.validate);

    // Render prompt
    const renderedPrompt = Mustache.render(IMPLEMENT_PROMPT_TEMPLATE, {
      instruction: prompt,
      schema: JSON.stringify(jsonSchema, null, 2),
      context: contextItems,
      callStack,
      timestamp,
      pid,
    });
    TRACE`Rendered prompt, length: ${renderedPrompt.length}`;

    // Create transcript
    const transcript = new Transcript();
    transcript.setTaskDetails(prompt, jsonSchema, contextItems);
    let computedResult: unknown;

    // Create in-process MCP server
    TRACE`Creating in-process MCP server`;
    const mcpServer = createMcpServer(vmExecutor, {
      onSetResult: (result) => {
        computedResult = result;
        TRACE`Stored set_result result: ${JSON.stringify(result)}`;
      },
      abort: () => {
        TRACE`set_result completed, will exit after current iteration`;
      },
      onToolCall: (tool, code, result) => {
        transcript.record(tool, code, result);
      },
    });

    try {
      // Call Claude Agent SDK directly
      TRACE`Calling query() with rendered prompt`;
      const result = query({
        prompt: renderedPrompt,
        options: {
          systemPrompt: {
            type: 'preset',
            preset: 'claude_code',
          },
          permissionMode: 'bypassPermissions',
          mcpServers: {
            klendathu: mcpServer,
          },
          allowedTools: ['Read', 'Grep'],
        },
      });
      TRACE`query() call initiated, starting message loop`;

      for await (const message of result) {
        TRACE`Received message type: ${message.type}`;
        transcript.recordMessage(message);
        // If result was computed via set_result, we can exit the loop
        if (computedResult !== undefined) {
          break;
        }
      }

      // Save transcript
      const success = computedResult !== undefined;
      TRACE`Saving transcript with success=${success}`;
      await transcript.save(cachePath, success);

      // Return result
      TRACE`Awaiting completion promise`;
      const finalResult = await vmExecutor.getCompletion();
      TRACE`Completion promise resolved`;
      return finalResult;

    } catch (error) {
      // Save transcript with failure flag
      TRACE`Implementation failed: ${error}`;
      await transcript.save(cachePath, false);
      throw error;
    }
  })();
}
