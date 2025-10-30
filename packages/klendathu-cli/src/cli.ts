/**
 * klendathu CLI
 *
 * Connects to an MCP debugging server and uses Claude to investigate runtime errors.
 *
 * Usage:
 *   klendathu http://localhost:2839/mcp
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import Mustache from 'mustache';
import { CliInputSchema } from './types.js';
import { INVESTIGATE_PROMPT_TEMPLATE, IMPLEMENT_PROMPT_TEMPLATE } from './strings.js';

function emitEvent(message: any) {
  console.error(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
}

async function main() {
  // Read JSON input from stdin
  let stdinData = '';
  for await (const chunk of process.stdin) {
    stdinData += chunk;
  }

  if (!stdinData.trim()) {
    emitEvent({ type: 'log', message: 'Error: No input provided on stdin' });
    process.exit(1);
  }

  // Parse and validate stdin input
  let input;
  try {
    const rawInput = JSON.parse(stdinData);
    input = CliInputSchema.parse(rawInput);
  } catch (error) {
    emitEvent({ type: 'log', message: `Error: Invalid stdin input: ${error}` });
    process.exit(1);
  }

  // Build prompt from template based on mode
  const prompt = input.mode === 'investigate'
    ? Mustache.render(INVESTIGATE_PROMPT_TEMPLATE, input)
    : Mustache.render(IMPLEMENT_PROMPT_TEMPLATE, input);

  const { mcpUrl } = input;

  emitEvent({ type: 'log', message: `Connecting to MCP server at ${mcpUrl}...` });

  try {
    const result = query({
      prompt,
      options: {
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
        },
        permissionMode: 'bypassPermissions', // Auto-accept all operations
        mcpServers: {
          debugger: {
            type: 'http',
            url: mcpUrl,
          },
        },
        // All Claude Code tools are available: Read, Write, Edit, Bash, Grep, Glob, etc.
        // No tool restrictions - agent has full access to investigate
      },
    });

    let turnNumber = 0;
    const toolCalls = new Map<string, string>();

    for await (const message of result) {
      if (message.type === 'assistant') {
        turnNumber++;
        emitEvent({
          type: 'turn',
          turnNumber,
          stopReason: message.message.stop_reason || undefined,
        });

        // Print assistant text messages to stdout
        for (const block of message.message.content) {
          if (block.type === 'text') {
            console.log(block.text);
          } else if (block.type === 'tool_use') {
            toolCalls.set(block.id, block.name);
            emitEvent({
              type: 'tool_call',
              toolName: block.name,
              input: block.input,
            });
          }
        }
      } else if (message.type === 'user') {
        // User messages contain tool results
        for (const block of message.message.content) {
          if (block.type === 'tool_result') {
            const toolName = toolCalls.get(block.tool_use_id) || 'unknown';
            let resultPreview = '';
            for (const content of block.content) {
              if (typeof content === 'object' && content.type === 'text') {
                resultPreview = content.text.slice(0, 200);
                break;
              }
            }
            emitEvent({
              type: 'tool_result',
              toolName,
              resultPreview,
            });
          }
        }
      } else if (message.type === 'result') {
        if (message.subtype === 'success') {
          console.log('\n--- Final Result ---');
          console.log(message.result);

          // Emit summary as the last stderr message
          emitEvent({
            type: 'summary',
            cost: message.total_cost_usd,
            turns: message.num_turns,
          });
        } else {
          emitEvent({ type: 'log', message: `Error: ${message.subtype}` });
          process.exit(1);
        }
      }
    }
  } catch (error) {
    emitEvent({ type: 'log', message: `Failed to connect: ${error}` });
    process.exit(1);
  }
}

main().catch((error) => {
  emitEvent({ type: 'log', message: `Fatal error: ${error}` });
  process.exit(1);
});
