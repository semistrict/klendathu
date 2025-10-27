/**
 * klendathu CLI
 *
 * Connects to an MCP debugging server and uses Claude to investigate runtime errors.
 *
 * Usage:
 *   klendathu http://localhost:2839/mcp
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
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

  // Parse URL to extract host and port
  const url = new URL(mcpUrl);

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
        emitStderr({
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
            emitStderr({
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
            emitStderr({
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
          emitStderr({
            type: 'summary',
            cost: message.total_cost_usd,
            turns: message.num_turns,
          });
        } else {
          emitStderr({ type: 'log', message: `Error: ${message.subtype}` });
          process.exit(1);
        }
      }
    }
  } catch (error) {
    emitStderr({ type: 'log', message: `Failed to connect: ${error}` });
    process.exit(1);
  }
}

main().catch((error) => {
  emitStderr({ type: 'log', message: `Fatal error: ${error}` });
  process.exit(1);
});
