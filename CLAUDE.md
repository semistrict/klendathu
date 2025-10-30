# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**klendathu** is a runtime debugger that uses AI and the Model Context Protocol (MCP) to investigate errors in Node.js and Python applications. When an error occurs, it spawns an MCP server that provides an `eval` tool for inspecting error context, then launches a CLI that connects an AI provider to investigate.

Built with the [Vercel AI SDK](https://sdk.vercel.ai) and supports all major AI providers.

Named after the bug planet from Starship Troopers.

## Commands

```bash
# Build all packages (monorepo)
pnpm build

# Run all tests
pnpm test

# Run a single test file (Node.js)
cd packages/klendathu && pnpm test launcher.test
cd packages/e2e-test && pnpm test debugger.test

# Run Python tests
cd packages/klendathu-py && pytest

# Watch mode for development
pnpm dev

# Clean all build outputs
pnpm clean
```

## Architecture

The system has four main components that work together:

### 1. Node.js Library (`packages/klendathu`)

The main library that users import. Key files:

- **`launcher.ts`**: The `investigate()` function that orchestrates everything:
  - Accepts a context object with error and variables
  - Starts an HTTP MCP server with the debug context
  - Spawns the CLI as a child process
  - Pipes structured JSON input to the CLI via stdin (mcpUrl, callStack, context, etc.)
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

A bundled executable (via Vite):

- **`cli.ts`**:
  - Reads structured JSON input from stdin containing:
    - `mode`: 'investigate' or 'implement'
    - `mcpUrl`: HTTP MCP server URL
    - `callStack`: Array of stack frames
    - `context`: Array of context items with names/types/descriptions
    - `timestamp`, `pid`, `extraInstructions`
  - Renders prompt from template using Mustache
  - Uses `@anthropic-ai/claude-agent-sdk` `query()` function
  - Connects to MCP server with Claude Code preset (`systemPrompt: { type: 'preset', preset: 'claude_code' }`)
  - Permission mode: `bypassPermissions` (auto-accepts all operations)
  - Emits structured JSON to stderr for progress tracking
  - Outputs final investigation result to stdout

- **`types.ts`**: Input/output schemas
  - `CliInputSchema`: Discriminated union of InvestigateInput and ImplementInput
  - `StatusMessageSchema`: All stderr messages (log, server_started, turn, tool_call, tool_result, summary)

- **`strings.ts`**: Mustache prompt templates
  - `INVESTIGATE_PROMPT_TEMPLATE`: Instructions for investigating errors
  - `IMPLEMENT_PROMPT_TEMPLATE`: Instructions for implementing functionality

### 3. E2E Tests (`packages/e2e-test`)

- **`debugger.test.ts`**: Full integration test that:
  - Creates a real error (accessing undefined property)
  - Calls `investigate()` with error context
  - Spawns the actual server and CLI
  - Verifies the AI produces a useful investigation
  - Uses Claude Agent SDK (requires `ANTHROPIC_API_KEY`)
  - Note: Claude Agent SDK doesn't provide token counts or finishReason - these fields are optional in the summary

### 4. Python Library (`packages/klendathu-py`)

The Python implementation that provides the same functionality for Python applications:

- **`launcher.py`**: The `investigate()` and `implement()` functions for Python:
  - `investigate()`: Investigates errors with AI
    - Accepts a context dict with error and variables
    - Extracts call stack from Python exceptions (using traceback)
    - Returns a `DebuggerPromise` that resolves to Claude's investigation text
    - Provides `stderr` async iterator for structured progress messages
    - Provides `summary` property for cost/turn statistics
  - `implement()`: AI-driven implementation with structured output
    - Accepts a prompt, context, and Pydantic model for schema validation
    - Returns validated result matching the model schema
    - Agent must call `set_result` tool before finishing
  - Both spawn the same `klendathu-cli` (Node.js) as a subprocess
  - Pipes structured JSON input to the CLI via stdin

- **`server.py`**: Creates a Python MCP debug server:
  - Provides `eval` tool that executes Python code
  - Provides `set_result` tool for implement mode (validates against Pydantic model)
  - Provides `fail_implementation` tool for implement mode (allows agent to report failure with reason)
  - Uses Python's `eval()` with access to `context` (all user-provided variables)
  - Captures stdout/stderr output using `redirect_stdout` and `redirect_stderr`
  - Runs on a random HTTP port by default (using aiohttp)
  - Compatible with the same CLI protocol as the Node.js version

- **`types.py`**: Core type definitions:
  - `DebugContext`: The context object sent to the MCP server
  - `ImplementContext`: Context for implement mode (includes Pydantic model)
  - `DebuggerPromise`: Protocol for Promise-like object with `stderr` and `summary` properties
  - `StatusMessage`: TypedDict for structured stderr messages
  - Uses TypedDict and Protocol for type hints

- **Key differences from Node.js version**:
  - Uses `asyncio` instead of Promises
  - Uses Python's `traceback` module for call stack extraction
  - Uses `eval()` instead of `vm.runInContext()`
  - Uses `aiohttp` for HTTP server instead of Express
  - Compatible with Python 3.10+ (required by MCP SDK)

## Key Design Patterns

### ContextItem and ContextCallable

Users can wrap context variables in `ContextItem` to provide descriptions:

**Node.js:**
```typescript
investigate({
  error,
  userId: new ContextItem(userId, 'The authenticated user ID'),
  getData: new ContextCallable(getData, 'Function to fetch user data')
});
```

**Python:**
```python
investigate({
  'error': error,
  'user_id': ContextItem(user_id, 'The authenticated user ID'),
  'get_data': ContextCallable(get_data, 'Function to fetch user data')
})
```

### Structured Stderr Protocol

All stderr output is JSON with a `type` discriminator:
- `server_started`: MCP server URL
- `log`: General messages
- `turn`: Claude turn completed
- `tool_call`: Claude called an MCP tool
- `tool_result`: MCP tool execution result
- `summary`: Final statistics (turns, tokens, finishReason, toolCallsCount, warnings)

The launcher parses these and makes them available via the `stderr` async iterator.

### Dynamic Prompt Generation

The launcher sends structured JSON input to the CLI containing:
- Call stack frames (file paths, line numbers, function names)
- Context items (variable names, types, descriptions)
- Timestamp and PID
- User's `extraInstructions` if provided

The CLI renders this data into a prompt using Mustache templates from `strings.ts`.

### CLI Path Resolution

In development (monorepo), the launcher finds the CLI at:
`packages/klendathu-cli/dist/cli.js`

This is resolved relative to the launcher's import.meta.url.

## Build Process

- **klendathu**: TypeScript compiled with `tsc` (preserves .js extensions in imports)
- **klendathu-cli**: Uses Vite for bundling with TypeScript type-checking before build
  - Type-checking runs via `pnpm typecheck` (tsc --noEmit)
  - Vite bundles src/cli.ts into dist/cli.js with shebang using SSR mode
  - All Node.js built-in modules are externalized (via `builtinModules`)
  - Externalized dependencies: `@anthropic-ai/claude-agent-sdk`, `@modelcontextprotocol/sdk`
  - Other dependencies (mustache, zod) are bundled
  - chmod +x is applied via build script
- **Root pnpm test**: Runs `pnpm build` before tests to ensure everything is up-to-date

## Authentication

The CLI uses Claude Agent SDK which requires an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Get your API key from the [Anthropic Console](https://console.anthropic.com/).

## Testing Philosophy

- Unit tests in `packages/klendathu` for launcher and server logic
- E2E tests in `packages/e2e-test` use real Claude Agent SDK (requires `ANTHROPIC_API_KEY`)
- Tests verify: turns, cost
- Note: Claude Agent SDK doesn't provide token counts or finishReason (these are optional in Summary type)
- Tests cost money and are slow (~20-40s) as they use real AI APIs
- Test output written to `/tmp/klendathu-test-{timestamp}/` for debugging

## Additional Features

- **`implement.ts`**: Similar to `investigate()` but for AI-driven implementation
  - Accepts a prompt and Zod schema
  - Agent must call `set_result` tool with validated result
  - Returns typed result matching the schema

- **`playwright-hook.ts`**: Auto-investigation on Playwright test failures
  - Import via `NODE_OPTIONS="--import=klendathu/playwright-hook"`
  - Intercepts test failures and spawns investigation automatically

## Multi-Language Support

The architecture is designed to support multiple languages. Currently supports Node.js and Python:

1. Each language implements its own MCP server with an `eval` tool (JavaScript VM or Python eval)
2. The language-specific library launches the same `klendathu-cli` (Node.js)
3. The CLI is language-agnostic (just connects to MCP server URL and talks to Claude)
4. The structured JSON protocol over stdin/stderr is the same across all languages

**Supported Languages:**
- ✅ Node.js (`packages/klendathu`)
- ✅ Python (`packages/klendathu-py`)

**Future Languages:**
Adding support for Go, Ruby, etc. follows the same pattern:
1. Implement MCP server with `eval` tool in the target language
2. Implement launcher that spawns `klendathu-cli` with structured JSON input
3. Extract call stack using language-specific stack trace APIs
4. Test with the same CLI (no CLI changes needed)
