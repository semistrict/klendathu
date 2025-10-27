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
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { parseArgs } from 'node:util';

function emitStderr(message: any) {
  console.error(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
}

async function main() {
  const { positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
  });

  if (positionals.length === 0) {
    emitStderr({ type: 'log', message: 'Usage: klendathu <mcp-server-url>' });
    emitStderr({ type: 'log', message: 'Example: klendathu http://localhost:2839/mcp' });
    process.exit(1);
  }

  const mcpUrl = positionals[0];

  emitStderr({ type: 'log', message: `Connecting to MCP server at ${mcpUrl}...` });

  // Read prompt from stdin
  let prompt = '';
  for await (const chunk of process.stdin) {
    prompt += chunk;
  }

  if (!prompt.trim()) {
    emitStderr({ type: 'log', message: 'Error: No prompt provided on stdin' });
    process.exit(1);
  }

  // Create MCP client with HTTP transport
  const mcpClient = await createMCPClient({
    transport: {
      type: 'http',
      url: mcpUrl,
    },
  });

  try {
    // Get tools from the MCP server
    const mcpTools = await mcpClient.tools();

    // Create agent with Claude Code provider and MCP tools
    const agent = new Agent({
      model: claudeCode('sonnet'),
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
