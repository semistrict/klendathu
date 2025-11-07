/**
 * klendathu CLI
 *
 * Handles AI-powered code implementation via Claude Agent SDK.
 * Connects to Hono server via HTTP/UDS and uses MCP for tool execution.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import Mustache from 'mustache';
import { IMPLEMENT_PROMPT_TEMPLATE } from './strings.js';
import { TRACE } from 'klendathu-utils/logging';
import { createMcpServerWithHttpBackend } from './server.js';
import { UdsHttpClient } from './uds-client.js';
import { getCacheKey, getCachePath, loadCachedTranscript } from './cache.js';
import { Transcript } from './transcript.js';

export async function main(options?: { udsPath?: string }) {
  TRACE`CLI main() started, PID: ${process.pid}`;

  // Get UDS path from command line argument or options
  const udsPath = options?.udsPath || process.argv[2];

  if (!udsPath) {
    console.error('Error: UDS socket path required as argument');
    process.exit(1);
  }

  TRACE`Connecting to Hono server at ${udsPath}`;

  // Create HTTP client to connect to Hono server
  const httpClient = new UdsHttpClient(udsPath);

  // Fetch task details from Hono server
  let taskDetails: any;
  try {
    const response = await httpClient.get('/task');
    taskDetails = response.data;
    TRACE`Fetched task details from ${udsPath}`;
  } catch (error) {
    console.error('Error fetching task details:', error);
    process.exit(1);
  }

  // Build prompt from template using fetched task details
  const prompt = Mustache.render(IMPLEMENT_PROMPT_TEMPLATE, taskDetails);
  TRACE`Rendered prompt, length: ${prompt.length}`;
  TRACE`Full prompt:\n${prompt}`;

  // Check cache if schema is available
  let cachedTranscript: any = null;
  let cachePath: string | null = null;
  const cacheMode = process.env.KLENDATHU_CACHE_MODE || 'normal';
  const shouldIgnoreCache = cacheMode === 'ignore';
  const shouldForceCache = cacheMode === 'force-use';

  if (taskDetails.schema && !shouldIgnoreCache) {
    const cacheKey = getCacheKey(taskDetails.instruction, taskDetails.schema);
    cachePath = getCachePath(cacheKey);
    TRACE`Cache key: ${cacheKey}, path: ${cachePath}, mode: ${cacheMode}`;
    cachedTranscript = loadCachedTranscript(cachePath);

    if (cachedTranscript) {
      TRACE`Cache hit! Using cached transcript`;
      const calls = cachedTranscript.calls || cachedTranscript;

      // Find the last successful set_result call
      const lastSuccessful = calls
        .filter((call: any) => call.tool === 'set_result')
        .reverse()
        .find((call: any) => !call.result.error);

      if (!lastSuccessful) {
        TRACE`No successful set_result found in cached transcript`;
        console.error('Error: No successful result in cache');
        process.exit(1);
      }

      // Replay all calls in order to rebuild VM state
      try {
        for (const call of calls) {
          if (call.tool === 'eval') {
            TRACE`Replaying eval call`;
            const response = await httpClient.post('/eval', { code: call.code });
            // Compare result with what was recorded in transcript
            const originalWasError = call.result?.error === true;
            const responseObj = response.data as Record<string, unknown>;
            const currentIsError = responseObj?.error === true;

            // If original succeeded but current fails, environment has changed - fallback to fresh agent
            if (!originalWasError && currentIsError) {
              const errorMsg = typeof responseObj?.message === 'string' ? responseObj.message : 'Unknown error';
              TRACE`Eval result changed from success to failure: ${errorMsg}. Environment mismatch detected.`;
              throw new Error(`Eval environment mismatch: ${errorMsg}`);
            }
          }
        }

        // Then replay the successful set_result
        TRACE`Replaying set_result call via /complete endpoint`;
        const completeResponse = await httpClient.post('/complete', { code: lastSuccessful.code });
        // Compare result with what was recorded
        const originalWasError = lastSuccessful.result?.error === true;
        const completeObj = completeResponse.data as Record<string, unknown>;
        const currentIsError = completeObj?.error === true;

        // If original succeeded but current fails, environment has changed - fallback to fresh agent
        if (!originalWasError && currentIsError) {
          const errorMsg = typeof completeObj?.message === 'string' ? completeObj.message : 'Unknown error';
          TRACE`Set_result result changed from success to failure: ${errorMsg}. Environment mismatch detected.`;
          throw new Error(`Set_result environment mismatch: ${errorMsg}`);
        }
        console.log(JSON.stringify(lastSuccessful.result.data));
        process.exit(0);
      } catch (error) {
        TRACE`Failed to replay cached transcript: ${error}. Discarding transcript and running agent fresh`;
        console.error('Error replaying cached transcript:', error);
        // Don't exit - continue to run agent fresh as if no cache existed
      }
    } else if (shouldForceCache) {
      TRACE`Cache required but not found (KLENDATHU_CACHE=${cacheMode})`;
      console.error('Error: Cache required but cache not found');
      // Notify server of failure before exiting to reject the promise immediately
      await httpClient.post('/complete', {
        failure: true,
        message: 'Cache required but cache not found',
      }).catch(() => {});
      process.exit(1);
    }
  }

  // Store computed result when set_result is called
  let computedResult: unknown;

  // Track transcript of all tool calls
  const transcript = new Transcript();

  // Set task details in transcript if schema is available
  if (taskDetails.schema) {
    transcript.setTaskDetails(prompt, taskDetails.schema, taskDetails.context);
  }

  // Helper function to save intermediate transcript
  const saveIntermediateTranscript = async (success: boolean = false) => {
    if (cachePath) {
      try {
        TRACE`Saving intermediate transcript to ${cachePath} (success=${success})`;
        await transcript.save(cachePath, success);
      } catch (err) {
        TRACE`Failed to save intermediate transcript: ${err}`;
      }
    }
  };

  // Create in-process MCP server that delegates to HTTP backend
  TRACE`Creating in-process MCP server`;
  const mcpServer = createMcpServerWithHttpBackend(httpClient, {
    onSetResult: (result) => {
      computedResult = result;
      TRACE`Stored set_result result: ${JSON.stringify(result)}`;
    },
    abort: () => {
      TRACE`set_result completed, will exit after current iteration`;
    },
    onToolCall: (tool, code, result) => {
      transcript.record(tool, code, result);
      // Save intermediate transcript after each tool call (fire and forget)
      saveIntermediateTranscript(false).catch((err) => {
        TRACE`Failed to save transcript after tool call: ${err}`;
      });
    },
  });
  TRACE`MCP server created`;

  try {
    const result = query({
      prompt,
      options: {
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
        },
        permissionMode: 'bypassPermissions',
        mcpServers: {
          debugger: mcpServer,
        },
      },
    });
    TRACE`query() call initiated, starting message loop`;

    for await (const message of result) {
      TRACE`Received message type: ${message.type}`;
      transcript.recordMessage(message);
      // Save intermediate transcript after each message
      await saveIntermediateTranscript(false);
      // If result was computed via set_result, we can exit the loop
      if (computedResult !== undefined) {
        break;
      }
    }

    // Output the computed result
    const output = computedResult !== undefined ? computedResult : {};
    TRACE`Outputting result: ${JSON.stringify(output)}`;
    console.log(JSON.stringify(output));

    // Save final transcript with success flag if result was computed
    if (taskDetails.schema) {
      const success = computedResult !== undefined;
      TRACE`Saving final transcript with success=${success}`;
      await saveIntermediateTranscript(success);
    }
  } catch (error) {
    // Save transcript with failure flag before exiting
    TRACE`Implementation failed: ${error}`;
    if (taskDetails.schema) {
      TRACE`Saving transcript with success=false due to error`;
      await saveIntermediateTranscript(false);
    }
    console.error(`Failed to execute: ${error}`);
    process.exit(1);
  }
}

// Only run main() if this file is being executed directly, not imported in tests
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => {
    process.exit(1);
  });
}
