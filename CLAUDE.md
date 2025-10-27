# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**klendathu** is a runtime debugger that uses Claude and the Model Context Protocol (MCP) to investigate errors in Node.js applications. When an error occurs, it spawns an MCP server that provides an `eval` tool for inspecting error context, then launches a CLI that connects Claude to investigate.

Named after the bug planet from Starship Troopers.

## Commands

```bash
# Build all packages (monorepo)
pnpm build

# Run all tests
pnpm test

# Run a single test file
cd packages/klendathu && pnpm test src/launcher.test.ts
cd packages/e2e-test && pnpm test src/debugger.test.ts

# Watch mode for development
pnpm dev

# Clean all build outputs
pnpm clean
```

## Architecture

The system has three main components that work together:

### 1. Library (`packages/klendathu`)

The main library that users import. Key files:

- **`launcher.ts`**: The `investigate()` function that orchestrates everything:
  - Accepts a context object with error and variables
  - Starts an HTTP MCP server with the debug context
  - Spawns the CLI as a child process
  - Pipes a dynamically generated prompt to the CLI via stdin
  - Returns a Promise that resolves to Claude's investigation text
  - Provides `stderr` async iterator for structured progress messages
  - Provides `summary` Promise for cost/turn statistics

- **`server.ts`**: Creates the MCP debug server:
  - Provides a single `eval` tool that executes JS in a VM context
  - The VM has access to `context` (all user-provided variables) and Node.js globals
  - Captures `console.log()` output and returns it with the eval result
  - Runs on a random HTTP port by default

- **`types.ts`**: Core interfaces
  - `DebugContext`: The context object sent to the MCP server
  - `DebuggerPromise`: Special Promise with `stderr` and `summary` properties
  - `StderrMessage`: Zod schema for structured stderr (all stderr is JSON)

### 2. CLI (`packages/klendathu-cli`)

A single-file bundled executable (via esbuild):

- **`cli.ts`**:
  - Reads MCP server URL from command line args
  - Reads investigation prompt from stdin
  - Connects to the MCP server using `@anthropic-ai/claude-agent-sdk`
  - Uses Claude to investigate the error
  - Emits structured JSON to stderr for progress tracking
  - Outputs final investigation result to stdout

### 3. E2E Tests (`packages/e2e-test`)

- **`debugger.test.ts`**: Full integration test that:
  - Creates a real error (accessing undefined property)
  - Calls `investigate()` with error context
  - Spawns the actual server and CLI
  - Verifies Claude produces a useful investigation
  - Requires `ANTHROPIC_API_KEY` environment variable

## Key Design Patterns

### ContextItem and ContextCallable

Users can wrap context variables in `ContextItem` to provide descriptions:

```typescript
investigate({
  error,
  userId: new ContextItem(userId, 'The authenticated user ID'),
  getData: new ContextCallable(getData, 'Function to fetch user data')
});
```

### Structured Stderr Protocol

All stderr output is JSON with a `type` discriminator:
- `server_started`: MCP server URL
- `log`: General messages
- `turn`: Claude turn completed
- `tool_call`: Claude called a tool
- `tool_result`: Tool execution result
- `summary`: Final statistics (cost, turns)

The launcher parses these and makes them available via the `stderr` async iterator.

### Dynamic Prompt Generation

The launcher generates a prompt that includes:
- Error stack trace (if available)
- List of available context variables with descriptions
- Instructions for using the eval tool
- User's `extraInstructions` if provided

### CLI Path Resolution

In development (monorepo), the launcher finds the CLI at:
`packages/klendathu-cli/dist/cli.js`

This is resolved relative to the launcher's import.meta.url.

## Build Process

- **klendathu**: TypeScript compiled with `tsc` (preserves .js extensions in imports)
- **klendathu-cli**: Bundled with esbuild into a single file with shebang, external `@anthropic-ai/claude-agent-sdk`
  - The shebang is added via `--banner:js` flag (not in source)
  - chmod +x is applied via build script

## Testing Philosophy

- Unit tests in `packages/klendathu` for launcher and server logic
- E2E test actually calls the real Claude API (costs money, slow)
- Tests use explicit assertions, not vague ones (see user's CLAUDE.md rules)

## Future: Multi-Language Support

The architecture is designed to support Python, Go, etc.:
1. Each language implements its own MCP server with an `eval` tool
2. The language-specific library launches the same `klendathu-cli`
3. The CLI is language-agnostic (just connects to MCP and talks to Claude)
