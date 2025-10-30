/**
 * klendathu CLI
 *
 * Connects to an MCP debugging server and uses Claude to investigate runtime errors.
 *
 * Usage:
 *   klendathu http://localhost:2839/mcp
 *   klendathu playwright test   # Runs command with Playwright hook
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import Mustache from 'mustache';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { CliInputSchema } from 'klendathu-utils/types';
import { INVESTIGATE_PROMPT_TEMPLATE, IMPLEMENT_PROMPT_TEMPLATE } from './strings.js';
import { TRACE } from 'klendathu-utils/logging';

function emitEvent(message: any) {
  console.error(JSON.stringify({ ...message, timestamp: new Date().toISOString() }));
}

async function runWithPlaywrightHook(args: string[]) {
  TRACE`runWithPlaywrightHook called with args: ${JSON.stringify(args)}`;
  // Resolve path to playwright-hook
  const cliPath = fileURLToPath(import.meta.url);
  const cliDir = dirname(cliPath);
  // Go up from klendathu-cli/dist to klendathu-cli, then to packages, then to klendathu
  const klendathuPath = join(cliDir, '..', '..', 'klendathu', 'dist', 'playwright-hook.js');
  TRACE`Resolved playwright-hook path: ${klendathuPath}`;

  const nodeOptions = process.env.NODE_OPTIONS || '';
  const newNodeOptions = `${nodeOptions} --import=${klendathuPath}`.trim();
  TRACE`NODE_OPTIONS: ${newNodeOptions}`;

  const [command, ...commandArgs] = args;
  TRACE`Spawning: ${command} ${commandArgs.join(' ')}`;
  const child = spawn(command, commandArgs, {
    env: {
      ...process.env,
      NODE_OPTIONS: newNodeOptions,
    },
    stdio: 'inherit',
  });
  TRACE`Child process spawned with PID: ${child.pid}`;

  return new Promise<number>((resolve) => {
    child.on('close', (code) => {
      TRACE`Child process exited with code: ${code}`;
      resolve(code || 0);
    });
  });
}

async function main() {
  TRACE`CLI main() started, PID: ${process.pid}`;
  // Check if CLI was invoked with arguments
  const args = process.argv.slice(2);
  TRACE`CLI arguments: ${JSON.stringify(args)}`;
  if (args.length > 0) {
    TRACE`Running in command-with-hook mode`;
    // Run command with Playwright hook
    const exitCode = await runWithPlaywrightHook(args);
    TRACE`Exiting with code: ${exitCode}`;
    process.exit(exitCode);
  }

  TRACE`Running in stdin mode, reading input`;
  // Read JSON input from stdin
  let stdinData = '';
  for await (const chunk of process.stdin) {
    stdinData += chunk;
  }
  TRACE`Read ${stdinData.length} bytes from stdin`;

  if (!stdinData.trim()) {
    emitEvent({ type: 'log', message: 'Error: No input provided on stdin' });
    process.exit(1);
  }

  // Parse and validate stdin input
  let input;
  try {
    const rawInput = JSON.parse(stdinData);
    input = CliInputSchema.parse(rawInput);
    TRACE`Parsed input: mode=${input.mode}, mcpUrl=${input.mcpUrl}`;
  } catch (error) {
    emitEvent({ type: 'log', message: `Error: Invalid stdin input: ${error}` });
    process.exit(1);
  }

  // Build prompt from template based on mode
  const prompt = input.mode === 'investigate'
    ? Mustache.render(INVESTIGATE_PROMPT_TEMPLATE, input)
    : Mustache.render(IMPLEMENT_PROMPT_TEMPLATE, input);
  TRACE`Rendered prompt, length: ${prompt.length}`;

  const { mcpUrl } = input;

  emitEvent({ type: 'log', message: `Connecting to MCP server at ${mcpUrl}...` });
  TRACE`Calling query() with mcpUrl: ${mcpUrl}`;

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
    TRACE`query() call initiated, starting message loop`;

    let turnNumber = 0;
    const toolCalls = new Map<string, string>();

    for await (const message of result) {
      TRACE`Received message: ${JSON.stringify(message)}`;
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
          TRACE`Final result: ${message.result}`;
          console.log('\n--- Final Result ---');
          console.log(message.result);

          // Emit summary as the last stderr message
          emitEvent({
            type: 'summary',
            cost: message.total_cost_usd,
            turns: message.num_turns,
          });
        } else {
          TRACE`Investigation failed with subtype: ${message.subtype}`;
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
