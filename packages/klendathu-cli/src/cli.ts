/**
 * klendathu CLI
 *
 * Connects to an MCP debugging server and uses Claude to investigate runtime errors.
 *
 * Usage:
 *   klendathu http://localhost:2839/mcp
 */

import { Experimental_Agent as Agent } from 'ai';
import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import { z } from 'zod';
import { loadConfig } from './config.js';
import { createModel } from './providers.js';
import { loadProjectContext } from './context-loader.js';

const StdinInputSchema = z.object({
  mcpUrl: z.string().url(),
  prompt: z.string(),
  callerDir: z.string().optional(),
});

type StdinInput = z.infer<typeof StdinInputSchema>;

function emitStderr(message: any) {
  console.error(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
}

async function main() {
  // Read JSON input from stdin
  let stdinData = '';
  for await (const chunk of process.stdin) {
    stdinData += chunk;
  }

  if (!stdinData.trim()) {
    emitStderr({ type: 'log', message: 'Error: No input provided on stdin' });
    process.exit(1);
  }

  // Parse and validate stdin input
  let input: StdinInput;
  try {
    const parsed = JSON.parse(stdinData);
    input = StdinInputSchema.parse(parsed);
  } catch (error) {
    emitStderr({ type: 'log', message: `Error: Invalid stdin input: ${error}` });
    process.exit(1);
  }

  const { mcpUrl, prompt: userPrompt, callerDir } = input;

  emitStderr({ type: 'log', message: `Connecting to MCP server at ${mcpUrl}...` });

  // Load project context from AGENTS.md/CLAUDE.md if caller directory provided
  let projectContext = '';
  if (callerDir) {
    try {
      const context = await loadProjectContext(callerDir);
      if (context.filesFound.length > 0) {
        emitStderr({
          type: 'log',
          message: `Loaded project context from: ${context.filesFound.join(', ')}`
        });
        projectContext = context.content;
      }
    } catch (error) {
      emitStderr({
        type: 'log',
        message: `Warning: Could not load project context: ${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // Build final prompt with project context
  let prompt = '';
  if (projectContext) {
    prompt += `<project_context>\n`;
    prompt += `The following context was loaded from AGENTS.md/CLAUDE.md files in the project:\n\n`;
    prompt += projectContext;
    prompt += `\n</project_context>\n\n`;
  }
  prompt += userPrompt;

  // Create MCP client with HTTP transport
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: mcpUrl,
    },
  });

  try {
    // Load configuration
    const config = await loadConfig();
    emitStderr({ type: 'log', message: `Using provider: ${config.provider}${config.model ? ` (${config.model})` : ''}` });

    // Create model from config
    const model = await createModel(config);

    // Get tools from the MCP server
    const mcpTools = await mcpClient.tools();

    // Create agent with configured provider and MCP tools
    const agent = new Agent({
      model,
      tools: mcpTools,
      // No stop condition - let it run until completion
    });

    // Execute the agent
    const result = await agent.generate({
      prompt,
    });

    let turnNumber = 0;

    // Process steps and emit structured stderr
    // Each step is a complete generation round that may include tool calls and results
    emitStderr({ type: 'log', message: `Result has ${result.steps.length} steps` });
    for (const step of result.steps) {
      turnNumber++;
      emitStderr({
        type: 'turn',
        turnNumber,
        stopReason: step.finishReason,
      });

      // Emit tool calls
      if (step.toolCalls && step.toolCalls.length > 0) {
        for (const toolCall of step.toolCalls) {
          emitStderr({
            type: 'tool_call',
            toolName: toolCall.toolName,
            input: toolCall.input,
          });
        }
      }

      // Emit tool results
      if (step.toolResults && step.toolResults.length > 0) {
        for (const toolResult of step.toolResults) {
          emitStderr({
            type: 'tool_result',
            toolName: toolResult.toolName,
            resultPreview: JSON.stringify(toolResult.output).slice(0, 200),
          });
        }
      }
    }

    // Output the final text
    console.log('\n--- Final Result ---');
    console.log(result.text);

    // Count total tool calls across all steps
    const toolCallsCount = result.steps.reduce((count, step) => {
      return count + (step.toolCalls?.length ?? 0);
    }, 0);

    // Collect warnings if any
    const warnings = result.warnings?.map(w => {
      if (w.type === 'unsupported-setting') {
        return `Unsupported setting: ${w.setting}${w.details ? ` - ${w.details}` : ''}`;
      } else if (w.type === 'unsupported-tool') {
        return `Unsupported tool${w.details ? `: ${w.details}` : ''}`;
      } else {
        return w.message;
      }
    });

    // Emit summary as the last stderr message
    emitStderr({
      type: 'summary',
      turns: turnNumber,
      finishReason: result.finishReason,
      inputTokens: result.totalUsage.inputTokens ?? 0,
      outputTokens: result.totalUsage.outputTokens ?? 0,
      totalTokens: result.totalUsage.totalTokens ?? 0,
      reasoningTokens: result.totalUsage.reasoningTokens,
      cachedInputTokens: result.totalUsage.cachedInputTokens,
      toolCallsCount,
      warnings,
    });

  } catch (error) {
    emitStderr({ type: 'log', message: `Failed to execute agent: ${error}` });
    process.exit(1);
  } finally {
    await mcpClient.close();
  }
}

main().catch((error) => {
  emitStderr({ type: 'log', message: `Fatal error: ${error}` });
  process.exit(1);
});
